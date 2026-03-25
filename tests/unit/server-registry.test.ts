import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createServerRegistry,
  type ServerRecord,
} from "../../src/core/registry/server-registry"

const masterKey = Buffer.alloc(32, 7)

const createRegistry = (registryFile: string) =>
  createServerRegistry({
    registryFile,
    secretProvider: { getMasterKey: async () => masterKey },
  })

describe("server registry", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "open-code-registry-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test("stores server records encrypted at rest", async () => {
    const registryFile = join(tempDir, "servers.enc.json")
    const registry = createRegistry(registryFile)

    await registry.upsert({
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      labels: ["prod", "critical"],
      groups: ["edge"],
      metadata: { region: "us-east-1", owner: "platform" },
      auth: { kind: "password", secret: "super-secret" },
    })

    const disk = await readFile(registryFile, "utf8")
    expect(disk.includes("super-secret")).toBe(false)
    expect(await registry.resolve("prod-a")).toEqual({
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      labels: ["prod", "critical"],
      groups: ["edge"],
      metadata: { region: "us-east-1", owner: "platform" },
      auth: { kind: "password", secret: "super-secret" },
    })
  })

  test("a fresh registry instance can read previously written encrypted data", async () => {
    const registryFile = join(tempDir, "servers.enc.json")
    const firstRegistry = createRegistry(registryFile)

    await firstRegistry.upsert({
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "super-secret" },
    })

    const secondRegistry = createRegistry(registryFile)

    expect(await secondRegistry.resolve("prod-a")).toEqual({
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "super-secret" },
    })
  })

  test("multiple records coexist and widened auth shapes round-trip", async () => {
    const registry = createRegistry(join(tempDir, "servers.enc.json"))

    const passwordRecord: ServerRecord = {
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      labels: ["prod"],
      groups: ["edge"],
      metadata: { region: "us-east-1" },
      auth: { kind: "password", secret: "super-secret" },
    }

    const certificateRecord: ServerRecord = {
      id: "prod-b",
      host: "10.0.0.11",
      port: 2222,
      username: "deploy",
      labels: ["staging"],
      groups: ["batch"],
      metadata: { ticket: "OPS-42" },
      auth: {
        kind: "certificate",
        certificate: "certificate-body",
        privateKey: "private-key-body",
        passphrase: "cert-passphrase",
      },
    }

    await registry.upsert(passwordRecord)
    await registry.upsert(certificateRecord)

    expect(await registry.list()).toEqual([passwordRecord, certificateRecord])
  })

  test("serializes overlapping upserts so concurrent writes do not lose updates", async () => {
    const registryFile = join(tempDir, "servers.enc.json")
    let pendingCalls = 0
    let releaseFirstWrite: (() => void) | null = null
    let firstReleaseScheduled = false

    const registry = createServerRegistry({
      registryFile,
      secretProvider: {
        async getMasterKey() {
          pendingCalls += 1
          if (pendingCalls === 1) {
            await new Promise<void>((resolve) => {
              releaseFirstWrite = resolve
              setTimeout(resolve, 25)
            })
          }
          if (pendingCalls === 2 && releaseFirstWrite && !firstReleaseScheduled) {
            firstReleaseScheduled = true
            releaseFirstWrite()
          }
          return masterKey
        },
      },
    })

    const firstRecord: ServerRecord = {
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "super-secret" },
    }

    const secondRecord: ServerRecord = {
      id: "prod-b",
      host: "10.0.0.11",
      port: 22,
      username: "deploy",
      auth: {
        kind: "privateKey",
        privateKey: "private-key-body",
        passphrase: "key-passphrase",
      },
    }

    const pendingWrite = Promise.all([
      registry.upsert(firstRecord),
      registry.upsert(secondRecord),
    ])

    await pendingWrite

    expect(await registry.list()).toEqual([firstRecord, secondRecord])
  })

  test("reads wait for pending writes from the same registry instance", async () => {
    const registryFile = join(tempDir, "servers.enc.json")
    let blockedCallCount = 0
    let releaseWrite!: () => void
    let writeBlocked!: () => void
    const blocked = new Promise<void>((resolve) => {
      writeBlocked = resolve
    })

    const registry = createServerRegistry({
      registryFile,
      secretProvider: {
        async getMasterKey() {
          blockedCallCount += 1
          if (blockedCallCount === 1) {
            await new Promise<void>((resolve) => {
              releaseWrite = resolve
              writeBlocked()
            })
          }
          return masterKey
        },
      },
    })

    const record: ServerRecord = {
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "super-secret" },
    }

    const pendingUpsert = registry.upsert(record)
    await blocked

    const pendingResolve = registry.resolve("prod-a")
    const pendingList = registry.list()

    releaseWrite()

    await pendingUpsert
    expect(await pendingResolve).toEqual(record)
    expect(await pendingList).toEqual([record])
  })

  test("two registry instances do not lose records when upserting concurrently", async () => {
    const registryFile = join(tempDir, "servers.enc.json")
    let releaseFirstWrite!: () => void
    let firstWriteBlocked!: () => void
    const firstBlocked = new Promise<void>((resolve) => {
      firstWriteBlocked = resolve
    })

    const firstRegistry = createServerRegistry({
      registryFile,
      secretProvider: {
        async getMasterKey() {
          await new Promise<void>((resolve) => {
            releaseFirstWrite = resolve
            firstWriteBlocked()
          })
          return masterKey
        },
      },
    })

    const secondRegistry = createRegistry(registryFile)

    const firstRecord: ServerRecord = {
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "super-secret" },
    }

    const secondRecord: ServerRecord = {
      id: "prod-b",
      host: "10.0.0.11",
      port: 22,
      username: "deploy",
      auth: {
        kind: "privateKey",
        privateKey: "private-key-body",
      },
    }

    const firstUpsert = firstRegistry.upsert(firstRecord)
    await firstBlocked
    const secondUpsert = secondRegistry.upsert(secondRecord)
    releaseFirstWrite()
    await firstUpsert
    await secondUpsert

    const reloadedRegistry = createRegistry(registryFile)
    expect(await reloadedRegistry.list()).toEqual([firstRecord, secondRecord])
  })

  test("recovers from a stale lock file left on disk", async () => {
    const registryFile = join(tempDir, "servers.enc.json")
    const lockFile = `${registryFile}.lock`
    const registry = createRegistry(registryFile)

    await writeFile(lockFile, "stale")
    const staleTime = new Date(Date.now() - 60_000)
    await utimes(lockFile, staleTime, staleTime)

    const record: ServerRecord = {
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "super-secret" },
    }

    await registry.upsert(record)

    expect(await registry.list()).toEqual([record])
  })
})
