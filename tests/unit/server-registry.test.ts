import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServerRegistry } from "../../src/core/registry/server-registry"

describe("server registry", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "open-code-registry-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test("stores server records encrypted at rest", async () => {
    const registry = createServerRegistry({
      registryFile: join(tempDir, "servers.enc.json"),
      secretProvider: { getMasterKey: async () => Buffer.alloc(32, 7) },
    })

    await registry.upsert({
      id: "prod-a",
      host: "10.0.0.10",
      port: 22,
      username: "root",
      auth: { kind: "password", secret: "super-secret" },
    })

    const disk = await readFile(join(tempDir, "servers.enc.json"), "utf8")
    expect(disk.includes("super-secret")).toBe(false)
    expect(await registry.resolve("prod-a")).toMatchObject({
      id: "prod-a",
      host: "10.0.0.10",
    })
  })
})
