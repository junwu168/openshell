import { describe, expect, test } from "bun:test"

const toolNames = [
  "list_servers",
  "remote_exec",
  "remote_read_file",
  "remote_write_file",
  "remote_patch_file",
  "remote_list_dir",
  "remote_stat",
  "remote_find",
]

describe("OpenCode plugin", () => {
  test("registers explicit remote tools in plan order and serializes results", async () => {
    const { OpenCodePlugin } = await import("../../src/index")
    const { createOpenCodePlugin } = await import("../../src/opencode/plugin")
    const plugin = createOpenCodePlugin({
      ensureRuntimeDirs: async () => {},
      createRuntimeDependencies: () => ({
        registry: {
          list: async () => [],
          resolve: async () => null,
        },
        ssh: {
          exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
          readFile: async () => "",
          writeFile: async () => {},
          listDir: async () => [],
          stat: async () => ({ size: 0, mode: 0o644, isFile: true, isDirectory: false }),
        },
        audit: {
          preflightLog: async () => {},
          appendLog: async () => {},
          preflightSnapshots: async () => {},
          captureSnapshots: async () => {},
        },
      }),
    })

    expect(typeof OpenCodePlugin).toBe("function")

    const hooks = await plugin({
      client: {} as never,
      project: {} as never,
      directory: "/tmp/project",
      worktree: "/tmp/project",
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    })

    expect(Object.keys(hooks.tool ?? {})).toEqual(toolNames)
    expect(typeof hooks.tool?.list_servers?.execute).toBe("function")

    const serialized = await hooks.tool?.list_servers?.execute({}, {} as never)
    expect(JSON.parse(serialized ?? "null")).toMatchObject({
      status: "ok",
      tool: "list_servers",
      data: [],
      execution: { attempted: true, completed: true },
      audit: { logWritten: true, snapshotStatus: "not-applicable" },
    })
  })
})
