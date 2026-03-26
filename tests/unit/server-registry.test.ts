import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServerRegistry } from "../../src/core/registry/server-registry"

describe("server registry", () => {
  let tempDir: string
  let workspaceRoot: string
  let globalRegistryFile: string
  let workspaceRegistryFile: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "open-code-registry-"))
    workspaceRoot = join(tempDir, "repo")
    globalRegistryFile = join(tempDir, "config", "servers.json")
    workspaceRegistryFile = join(workspaceRoot, ".open-code", "servers.json")

    await mkdir(join(tempDir, "config"), { recursive: true })
    await mkdir(join(workspaceRoot, ".open-code"), { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const createRegistry = () =>
    createServerRegistry({
      globalRegistryFile,
      workspaceRegistryFile,
      workspaceRoot,
    })

  test("plain-text password is written as plain JSON", async () => {
    const registry = createRegistry()
    const record = {
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "super-secret" },
    }

    await registry.upsert("workspace", record)

    const disk = await readFile(workspaceRegistryFile, "utf8")
    expect(JSON.parse(disk)).toEqual([record])
  })

  test("workspace records override global records by id", async () => {
    const registry = createRegistry()
    const globalRecord = {
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "global-secret" },
    }
    const workspaceRecord = {
      id: "prod-a",
      host: "10.0.0.99",
      port: 2222,
      username: "deploy",
      auth: { kind: "password", secret: "workspace-secret" },
    }

    await writeFile(globalRegistryFile, JSON.stringify([globalRecord], null, 2))
    await writeFile(workspaceRegistryFile, JSON.stringify([workspaceRecord], null, 2))

    expect(await registry.resolve("prod-a")).toMatchObject({
      id: "prod-a",
      host: "10.0.0.99",
      port: 2222,
      username: "deploy",
      scope: "workspace",
      shadowingGlobal: true,
      workspaceRoot,
      auth: { kind: "password", secret: "workspace-secret" },
    })
  })

  test("duplicate ids resolve to the last record in a scope", async () => {
    const registry = createRegistry()
    const firstRecord = {
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "first-secret" },
    }
    const lastRecord = {
      id: "prod-a",
      host: "10.0.0.20",
      port: 2222,
      username: "deploy",
      auth: { kind: "password", secret: "last-secret" },
    }

    await writeFile(workspaceRegistryFile, JSON.stringify([firstRecord, lastRecord], null, 2))

    expect(await registry.list()).toEqual([
      {
        ...lastRecord,
        scope: "workspace",
        workspaceRoot,
      },
    ])
    expect(await registry.resolve("prod-a")).toEqual({
      ...lastRecord,
      scope: "workspace",
      workspaceRoot,
    })
  })

  test("list returns effective merged records with scope metadata", async () => {
    const registry = createRegistry()
    const globalOnly = {
      id: "prod-b",
      host: "10.0.0.11",
      port: 22,
      username: "ops",
      auth: { kind: "privateKey", privateKeyPath: "/keys/prod-b" },
    }
    const globalShadowed = {
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "global-secret" },
    }
    const workspaceShadow = {
      id: "prod-a",
      host: "10.0.0.99",
      port: 2222,
      username: "deploy",
      auth: { kind: "certificate", certificatePath: "/certs/prod-a.crt", privateKeyPath: "/keys/prod-a" },
    }

    await writeFile(globalRegistryFile, JSON.stringify([globalShadowed, globalOnly], null, 2))
    await writeFile(workspaceRegistryFile, JSON.stringify([workspaceShadow], null, 2))

    expect(await registry.list()).toEqual([
      {
        ...workspaceShadow,
        scope: "workspace",
        shadowingGlobal: true,
        workspaceRoot,
      },
      {
        ...globalOnly,
        scope: "global",
      },
    ])
  })

  test("listRaw returns unmerged records for each scope", async () => {
    const registry = createRegistry()
    const globalRecord = {
      id: "prod-b",
      host: "10.0.0.11",
      port: 22,
      username: "ops",
      auth: { kind: "privateKey", privateKeyPath: "/keys/prod-b" },
    }
    const workspaceRecord = {
      id: "prod-a",
      host: "10.0.0.99",
      port: 2222,
      username: "deploy",
      auth: { kind: "password", secret: "workspace-secret" },
    }

    await writeFile(globalRegistryFile, JSON.stringify([globalRecord], null, 2))
    await writeFile(workspaceRegistryFile, JSON.stringify([workspaceRecord], null, 2))

    expect(await registry.listRaw("global")).toEqual([globalRecord])
    expect(await registry.listRaw("workspace")).toEqual([workspaceRecord])
  })

  test("reads wait for pending writes from the same registry instance", async () => {
    const lockFile = `${workspaceRegistryFile}.lock`
    const workspaceRecord = {
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "super-secret" },
    }
    let releaseProcessStartTime!: () => void
    let writeBlocked!: () => void
    const blocked = new Promise<void>((resolve) => {
      writeBlocked = resolve
    })

    const registry = createServerRegistry({
      globalRegistryFile,
      workspaceRegistryFile,
      workspaceRoot,
      lockOptions: {
        getProcessStartTime: async (pid) => {
          if (pid === process.pid) {
            await new Promise<void>((resolve) => {
              releaseProcessStartTime = resolve
              writeBlocked()
            })
          }

          return Date.now()
        },
      },
    })

    await writeFile(lockFile, JSON.stringify({ pid: process.pid, createdAt: new Date(0).toISOString() }))

    const pendingUpsert = registry.upsert("workspace", workspaceRecord)
    await blocked

    const pendingResolve = registry.resolve("prod-a")
    const pendingList = registry.list()

    releaseProcessStartTime()

    await pendingUpsert
    expect(await pendingResolve).toEqual({
      ...workspaceRecord,
      scope: "workspace",
      workspaceRoot,
    })
    expect(await pendingList).toEqual([
      {
        ...workspaceRecord,
        scope: "workspace",
        workspaceRoot,
      },
    ])
  })

  test("serializes overlapping upserts without losing updates", async () => {
    const lockFile = `${workspaceRegistryFile}.lock`
    let releaseProcessStartTime!: () => void
    let writeBlocked!: () => void
    const blocked = new Promise<void>((resolve) => {
      writeBlocked = resolve
    })

    const firstRegistry = createServerRegistry({
      globalRegistryFile,
      workspaceRegistryFile,
      workspaceRoot,
      lockOptions: {
        getProcessStartTime: async (pid) => {
          if (pid === process.pid) {
            await new Promise<void>((resolve) => {
              releaseProcessStartTime = resolve
              writeBlocked()
            })
          }

          return Date.now()
        },
      },
    })

    await writeFile(lockFile, JSON.stringify({ pid: process.pid, createdAt: new Date(0).toISOString() }))

    const firstRecord = {
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "super-secret" },
    }
    const secondRecord = {
      id: "prod-b",
      host: "10.0.0.11",
      port: 22,
      username: "deploy",
      auth: {
        kind: "privateKey",
        privateKeyPath: "/keys/prod-b",
      },
    }

    const firstUpsert = firstRegistry.upsert("workspace", firstRecord)
    await blocked
    const secondUpsert = firstRegistry.upsert("workspace", secondRecord)
    releaseProcessStartTime()

    await firstUpsert
    await secondUpsert

    const reloadedRegistry = createRegistry()
    expect(await reloadedRegistry.list()).toEqual([
      {
        ...firstRecord,
        scope: "workspace",
        workspaceRoot,
      },
      {
        ...secondRecord,
        scope: "workspace",
        workspaceRoot,
      },
    ])
  })

  test("two registry instances contend for the same file without losing records", async () => {
    const lockFile = `${workspaceRegistryFile}.lock`
    let releaseProcessStartTime!: () => void
    let firstBlocked!: () => void
    const blocked = new Promise<void>((resolve) => {
      firstBlocked = resolve
    })

    const firstRegistry = createServerRegistry({
      globalRegistryFile,
      workspaceRegistryFile,
      workspaceRoot,
      lockOptions: {
        getProcessStartTime: async (pid) => {
          if (pid === process.pid) {
            await new Promise<void>((resolve) => {
              releaseProcessStartTime = resolve
              firstBlocked()
            })
          }

          return Date.now()
        },
      },
    })
    const secondRegistry = createRegistry()

    await writeFile(lockFile, JSON.stringify({ pid: process.pid, createdAt: new Date(0).toISOString() }))

    const firstRecord = {
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "super-secret" },
    }
    const secondRecord = {
      id: "prod-b",
      host: "10.0.0.11",
      port: 22,
      username: "deploy",
      auth: {
        kind: "privateKey",
        privateKeyPath: "/keys/prod-b",
      },
    }

    const firstUpsert = firstRegistry.upsert("workspace", firstRecord)
    await blocked
    const secondUpsert = secondRegistry.upsert("workspace", secondRecord)
    releaseProcessStartTime()

    await firstUpsert
    await secondUpsert

    const reloadedRegistry = createRegistry()
    const ids = (await reloadedRegistry.list()).map((record) => record.id).sort()
    expect(ids).toEqual(["prod-a", "prod-b"])
  })

  test("reclaims a lock when the pid now belongs to a newer process", async () => {
    const lockFile = `${workspaceRegistryFile}.lock`
    const registry = createServerRegistry({
      globalRegistryFile,
      workspaceRegistryFile,
      workspaceRoot,
      lockOptions: {
        getProcessStartTime: async (pid) => (pid === process.pid ? Date.now() : null),
      },
    })

    await writeFile(lockFile, JSON.stringify({ pid: process.pid, createdAt: new Date(0).toISOString() }))

    const record = {
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "super-secret" },
    }

    await registry.upsert("workspace", record)

    expect(await registry.list()).toEqual([
      {
        ...record,
        scope: "workspace",
        workspaceRoot,
      },
    ])
  })

  test("times out when a live lock owner keeps the registry busy", async () => {
    const lockFile = `${workspaceRegistryFile}.lock`
    const registry = createServerRegistry({
      globalRegistryFile,
      workspaceRegistryFile,
      workspaceRoot,
      lockOptions: {
        getProcessStartTime: async (pid) => (pid === process.pid ? Date.now() - 1_000 : null),
        retryMs: 5,
        timeoutMs: 40,
      },
    })

    await writeFile(lockFile, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))

    await expect(
      registry.upsert("workspace", {
        id: "prod-a",
        host: "10.0.0.10",
        port: 22,
        username: "root",
        auth: { kind: "password", secret: "super-secret" },
      }),
    ).rejects.toThrow("Timed out waiting for registry lock")
  })
})
