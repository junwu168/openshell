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
})
