import { describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("runtime paths", () => {
  test("ensureRuntimeDirs prepares the audit repo directory", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "opencode-paths-"))
    try {
      const configDir = join(tempRoot, "config")
      const dataDir = join(tempRoot, "data")

      mock.module("env-paths", () => ({
        default: () => ({ config: configDir, data: dataDir }),
      }))

      const { ensureRuntimeDirs, runtimePaths } = await import("../../src/core/paths")
      await ensureRuntimeDirs()

      const pathStat = await stat(runtimePaths.auditRepoDir)
      expect(pathStat.isDirectory()).toBe(true)
    } finally {
      mock.restore()
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
