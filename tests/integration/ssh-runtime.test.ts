import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createSshRuntime } from "../../src/core/ssh/ssh-runtime"
import { startFakeSshServer } from "./fake-ssh-server"

describe("ssh runtime", () => {
  let server: Awaited<ReturnType<typeof startFakeSshServer>> | undefined
  let runtime: ReturnType<typeof createSshRuntime>

  beforeAll(async () => {
    server = await startFakeSshServer()
    runtime = createSshRuntime()
  }, { timeout: 60_000 })

  afterAll(async () => {
    await server?.stop()
  }, { timeout: 30_000 })

  test("executes a safe remote command", async () => {
    const result = await runtime.exec(server.connection, "cat /tmp/open-code/hosts")
    expect(result.stdout).toContain("localhost")
  })

  test("executes commands from a cwd that contains spaces", async () => {
    await runtime.exec(server.connection, "mkdir -p '/tmp/open code'")

    const result = await runtime.exec(server.connection, "pwd", { cwd: "/tmp/open code" })

    expect(result.stdout.trim()).toBe("/tmp/open code")
  })

  test("times out long-running commands", async () => {
    await expect(runtime.exec(server.connection, "sleep 2", { timeout: 50 })).rejects.toThrow(
      "command timed out after 50ms",
    )
  })

  test("writes and reads a remote file through sftp", async () => {
    await runtime.writeFile(server.connection, "/tmp/open-code/app.conf", "port=80\n")

    expect(await runtime.readFile(server.connection, "/tmp/open-code/app.conf")).toBe("port=80\n")
  })

  test("lists and stats remote paths", async () => {
    const entries = await runtime.listDir(server.connection, "/tmp/open-code", false, 50)
    const recursiveEntries = await runtime.listDir(server.connection, "/tmp/open-code", true, 50)

    expect(entries.some((entry) => entry.name === "hosts")).toBe(true)
    expect(entries.some((entry) => entry.name === "app.conf")).toBe(true)
    expect(recursiveEntries).toContain("/tmp/open-code/hosts")
    await expect(runtime.listDir(server.connection, "/tmp/does-not-exist", true, 50)).rejects.toThrow()
    expect(await runtime.stat(server.connection, "/tmp/open-code/hosts")).toMatchObject({ isFile: true })
  })

  test("applies a unified patch before writing the updated file", async () => {
    const { applyUnifiedPatch } = await import("../../src/core/patch")
    const current = await runtime.readFile(server.connection, "/tmp/open-code/app.conf")
    const next = applyUnifiedPatch(
      current,
      [
        "--- app.conf",
        "+++ app.conf",
        "@@ -1 +1 @@",
        "-port=80",
        "+port=8080",
        "",
      ].join("\n"),
    )

    await runtime.writeFile(server.connection, "/tmp/open-code/app.conf", next)

    expect(await runtime.readFile(server.connection, "/tmp/open-code/app.conf")).toBe("port=8080\n")
  })
})
