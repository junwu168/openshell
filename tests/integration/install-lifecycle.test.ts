import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const createWritable = () => {
  let buffer = ""

  return {
    write(chunk: string) {
      buffer += chunk
    },
    toString() {
      return buffer
    },
  }
}

describe("openshell install lifecycle", () => {
  test("install creates openshell state and uninstall removes tracked workspaces", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "openshell-install-lifecycle-"))
    tempDirs.push(tempDir)

    const configDir = join(tempDir, "config", "openshell")
    const dataDir = join(tempDir, "data", "openshell")
    const opencodeConfigDir = join(tempDir, "config", "opencode")
    const opencodeConfigFile = join(opencodeConfigDir, "opencode.json")
    const workspaceRoot = join(tempDir, "workspace")
    const managedPath = join(workspaceRoot, ".open-code")

    await mkdir(managedPath, { recursive: true })
    await writeFile(join(managedPath, "servers.json"), "[]")
    await mkdir(opencodeConfigDir, { recursive: true })
    await writeFile(opencodeConfigFile, JSON.stringify({ plugin: ["existing-plugin"] }))

    const runtimePaths = {
      configDir,
      dataDir,
      globalRegistryFile: join(configDir, "servers.json"),
      workspaceTrackerFile: join(dataDir, "workspaces.json"),
      opencodeConfigDir,
      opencodeConfigFile,
      workspaceRegistryDir: join(workspaceRoot, ".open-code"),
      workspaceRegistryFile: join(workspaceRoot, ".open-code", "servers.json"),
      auditLogFile: join(dataDir, "audit", "actions.jsonl"),
      auditRepoDir: join(dataDir, "audit", "repo"),
    }

    const stdout = createWritable()
    const { installOpenShell } = await import("../../src/product/install")
    await installOpenShell({ runtimePaths, stdout })

    const installedConfig = JSON.parse(await readFile(opencodeConfigFile, "utf8"))
    expect(installedConfig.plugin).toContain("@junwu168/openshell")
    expect(stdout.toString()).toContain("Installed openshell")

    const trackerFile = join(dataDir, "workspaces.json")
    await writeFile(
      trackerFile,
      JSON.stringify([
        {
          workspaceRoot,
          managedPath,
        },
      ]),
    )

    const uninstallStdout = createWritable()
    const { uninstallOpenShell } = await import("../../src/product/uninstall")
    await uninstallOpenShell({ runtimePaths, stdout: uninstallStdout })

    await expect(readFile(opencodeConfigFile, "utf8")).resolves.toContain("existing-plugin")
    await expect(readFile(opencodeConfigFile, "utf8")).resolves.not.toContain("@junwu168/openshell")
    await expect(rm(managedPath, { recursive: false })).rejects.toMatchObject({ code: "ENOENT" })
    await expect(rm(configDir, { recursive: false })).rejects.toMatchObject({ code: "ENOENT" })
    await expect(rm(dataDir, { recursive: false })).rejects.toMatchObject({ code: "ENOENT" })
    expect(uninstallStdout.toString()).toContain("Removed openshell")
  })
})
