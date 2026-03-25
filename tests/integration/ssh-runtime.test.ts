import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createSshRuntime } from "../../src/core/ssh/ssh-runtime"
import { applyUnifiedPatch } from "../../src/core/patch"
import { startFakeSshServer } from "./fake-ssh-server"

describe("ssh runtime", () => {
  let server: Awaited<ReturnType<typeof startFakeSshServer>> | undefined
  let runtime: ReturnType<typeof createSshRuntime>

  beforeAll(async () => {
    server = await startFakeSshServer()
    runtime = createSshRuntime()
    await Bun.sleep(5_000)
    await runtime.exec(server.connection, "mkdir -p /tmp/open-code")
    await runtime.writeFile(server.connection, "/tmp/open-code/hosts", "127.0.0.1 localhost\n")
    await runtime.writeFile(server.connection, "/tmp/open-code/app.conf", "port=80\n")
  }, { timeout: 60_000 })

  afterAll(async () => {
    await server?.stop()
  }, { timeout: 30_000 })

  test("executes a safe remote command", async () => {
    const result = await runtime.exec(server.connection, "cat /tmp/open-code/hosts")
    expect(result.stdout).toContain("localhost")
  })

  test("writes and reads a remote file through sftp", async () => {
    await runtime.writeFile(server.connection, "/tmp/open-code/app.conf", "port=80\n")

    expect(await runtime.readFile(server.connection, "/tmp/open-code/app.conf")).toBe("port=80\n")
  })

  test("lists and stats remote paths", async () => {
    const entries = await runtime.listDir(server.connection, "/tmp/open-code", false, 50)

    expect(Array.isArray(entries)).toBe(true)
    expect(await runtime.stat(server.connection, "/tmp/open-code/hosts")).toMatchObject({ isFile: true })
  })

  test("applies a unified patch before writing the updated file", async () => {
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
