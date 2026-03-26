import { describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("runtime paths", () => {
  test("runtime paths expose global and workspace server config locations", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "opencode-paths-"))
    try {
      const configDir = join(tempRoot, "config")
      const dataDir = join(tempRoot, "data")

      mock.module("env-paths", () => ({
        default: () => ({ config: configDir, data: dataDir }),
      }))

      const { createRuntimePaths, runtimePaths } = await import("../../src/core/paths?runtime-paths-test-1")
      const runtime = createRuntimePaths("/repo")

      expect(runtime.globalRegistryFile.endsWith("servers.json")).toBe(true)
      expect(runtime.workspaceRegistryFile).toBe("/repo/.open-code/servers.json")
      expect(runtimePaths.globalRegistryFile.endsWith("servers.json")).toBe(true)
    } finally {
      mock.restore()
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  test("ensureRuntimeDirs prepares the audit repo directory", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "opencode-paths-"))
    try {
      const configDir = join(tempRoot, "config")
      const dataDir = join(tempRoot, "data")

      mock.module("env-paths", () => ({
        default: () => ({ config: configDir, data: dataDir }),
      }))

      const { ensureRuntimeDirs, runtimePaths } = await import("../../src/core/paths?runtime-paths-test-2")
      await ensureRuntimeDirs()

      const pathStat = await stat(runtimePaths.auditRepoDir)
      expect(pathStat.isDirectory()).toBe(true)
    } finally {
      mock.restore()
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
