import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { startFakeSshServer } from "./fake-ssh-server"

let createSshRuntime: typeof import("../../src/core/ssh/ssh-runtime").createSshRuntime

describe("ssh runtime", () => {
  let server: Awaited<ReturnType<typeof startFakeSshServer>> | undefined
  let runtime: ReturnType<typeof createSshRuntime>

  beforeAll(async () => {
    server = await startFakeSshServer()
    createSshRuntime = (await import("../../src/core/ssh/ssh-runtime?integration-real")).createSshRuntime
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

  test("supports relative cwd values that start with a dash", async () => {
    const home = (await runtime.exec(server.connection, "pwd")).stdout.trim()
    await runtime.exec(server.connection, "mkdir -- -cwd")

    const result = await runtime.exec(server.connection, "pwd", { cwd: "-cwd" })

    expect(result.stdout.trim()).toBe(`${home}/-cwd`)
  })

  test("times out long-running commands", async () => {
    await expect(runtime.exec(server.connection, "sleep 2", { timeout: 50 })).rejects.toThrow(
      "command timed out after 50ms",
    )
  })

  test("reports signal-terminated commands as non-zero exits", async () => {
    const result = await runtime.exec(server.connection, "sh -lc 'kill -TERM $$'")

    expect(result.exitCode).toBe(143)
  })

  test("does not allow timed out commands to mutate remote state later", async () => {
    await runtime.writeFile(server.connection, "/tmp/open-code/app.conf", "port=80\n")

    await expect(
      runtime.exec(
        server.connection,
        "sh -lc \"sleep 1; echo late >> /tmp/open-code/app.conf\"",
        { timeout: 100 },
      ),
    ).rejects.toThrow("command timed out after 100ms")

    await Bun.sleep(1_500)

    expect(await runtime.readFile(server.connection, "/tmp/open-code/app.conf")).toBe("port=80\n")
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

  test("enforces list limits in both listing modes", async () => {
    const entries = await runtime.listDir(server.connection, "/tmp/open-code", false, 1)
    const recursiveEntries = await runtime.listDir(server.connection, "/tmp/open-code", true, 1)

    expect(entries).toHaveLength(1)
    expect(recursiveEntries).toHaveLength(1)
  })

  test("times out stalled sftp operations", async () => {
    const impatientRuntime = createSshRuntime({ operationTimeoutMs: 0 })

    await expect(impatientRuntime.readFile(server.connection, "/tmp/open-code/app.conf")).rejects.toThrow(
      "ssh operation timed out after 0ms",
    )
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
