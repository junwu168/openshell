import { describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("runtime paths", () => {
  test("runtime paths use openshell app directories and expose OpenCode config", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "opencode-paths-"))
    const previousXdgConfigHome = process.env.XDG_CONFIG_HOME
    try {
      const openshellConfigDir = join(tempRoot, "openshell-config")
      const openshellDataDir = join(tempRoot, "openshell-data")
      const opencodeConfigDir = join(tempRoot, "xdg-config", "opencode")

      mock.module("env-paths", () => ({
        default: (name: string) => {
          if (name === "openshell") {
            return { config: openshellConfigDir, data: openshellDataDir }
          }

          throw new Error(`unexpected env-paths name: ${name}`)
        },
      }))
      process.env.XDG_CONFIG_HOME = join(tempRoot, "xdg-config")

      const { createRuntimePaths, runtimePaths } = await import("../../src/core/paths?runtime-paths-test-1")
      const runtime = createRuntimePaths("/repo")

      expect(runtime.configDir).toBe(openshellConfigDir)
      expect(runtime.dataDir).toBe(openshellDataDir)
      expect(runtime.globalRegistryFile.endsWith("servers.json")).toBe(true)
      expect(runtime.workspaceRegistryFile).toBe("/repo/.open-code/servers.json")
      expect(runtime.opencodeConfigDir).toBe(opencodeConfigDir)
      expect(runtime.opencodeConfigFile).toBe(join(opencodeConfigDir, "opencode.json"))
      expect(runtimePaths.globalRegistryFile.endsWith("servers.json")).toBe(true)
    } finally {
      if (previousXdgConfigHome === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = previousXdgConfigHome
      }
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
