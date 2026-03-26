import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("opencode config integration", () => {
  test("install merges openshell into the global OpenCode plugin list", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "openshell-opencode-config-"))
    tempDirs.push(tempDir)
    const opencodeConfigFile = join(tempDir, "opencode.json")
    await writeFile(
      opencodeConfigFile,
      JSON.stringify({
        plugin: ["existing-plugin"],
        permission: {
          edit: "ask",
          bash: {
            "kubectl *": "ask",
          },
        },
      }),
    )

    const { installIntoOpenCodeConfig, defaultBashPermissions } = await import("../../src/product/opencode-config")
    await installIntoOpenCodeConfig(opencodeConfigFile)

    const merged = JSON.parse(await readFile(opencodeConfigFile, "utf8"))
    expect(merged).toMatchObject({
      plugin: ["existing-plugin", "@junwu168/openshell"],
      permission: {
        edit: "ask",
        bash: expect.objectContaining({
          ...defaultBashPermissions,
          "kubectl *": "ask",
        }),
      },
    })
  })

  test("uninstall removes openshell registration while preserving unrelated plugins", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "openshell-opencode-config-"))
    tempDirs.push(tempDir)
    const opencodeConfigFile = join(tempDir, "opencode.json")
    await writeFile(
      opencodeConfigFile,
      JSON.stringify({
        plugin: ["existing-plugin", "@junwu168/openshell"],
        permission: {
          edit: "ask",
          bash: {
            "kubectl *": "ask",
            "cat *": "allow",
            "grep *": "allow",
          },
        },
      }),
    )

    const { uninstallFromOpenCodeConfig } = await import("../../src/product/opencode-config")
    await uninstallFromOpenCodeConfig(opencodeConfigFile)

    const merged = JSON.parse(await readFile(opencodeConfigFile, "utf8"))
    expect(merged.plugin).toEqual(["existing-plugin"])
    expect(merged.permission.bash).toEqual({
      "kubectl *": "ask",
    })
  })

  test("uninstall removes the plugin key when openshell was the only registered plugin", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "openshell-opencode-config-"))
    tempDirs.push(tempDir)
    const opencodeConfigFile = join(tempDir, "opencode.json")
    await writeFile(
      opencodeConfigFile,
      JSON.stringify({
        plugin: ["@junwu168/openshell"],
        permission: {
          edit: "ask",
          bash: {
            "*": "ask",
            "cat *": "allow",
          },
        },
      }),
    )

    const { uninstallFromOpenCodeConfig } = await import("../../src/product/opencode-config")
    await uninstallFromOpenCodeConfig(opencodeConfigFile)

    const merged = JSON.parse(await readFile(opencodeConfigFile, "utf8"))
    expect(merged.plugin).toBeUndefined()
    expect(merged.permission).toBeUndefined()
  })
})
