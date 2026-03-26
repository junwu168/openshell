import { Client, type ConnectConfig } from "ssh2"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { GenericContainer, Wait } from "testcontainers"

const SSH_IMAGE = "linuxserver/openssh-server:10.2_p1-r0-ls219"

const waitForSshReady = async (connection: ConnectConfig, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const client = new Client()
        let settled = false

        const finish = (handler: () => void) => {
          if (settled) {
            return
          }

          settled = true
          handler()
          client.end()
        }

        client
          .on("ready", () => finish(resolve))
          .on("error", (error) => finish(() => reject(error)))
          .connect({
            ...connection,
            readyTimeout: Math.min(2_000, Math.max(1, deadline - Date.now())),
          })
      })

      return
    } catch (error) {
      lastError = error
      await Bun.sleep(250)
    }
  }

  throw lastError ?? new Error("ssh readiness timed out")
}

export const startFakeSshServer = async () => {
  const seedDir = await mkdtemp(join(tmpdir(), "open-code-open-ssh-"))
  await mkdir(join(seedDir, "open-code"), { recursive: true })
  await writeFile(join(seedDir, "open-code", "hosts"), "127.0.0.1 localhost\n")
  await writeFile(join(seedDir, "open-code", "app.conf"), "port=80\n")

  const container = await new GenericContainer(SSH_IMAGE)
    .withBindMounts([{ source: join(seedDir, "open-code"), target: "/tmp/open-code", mode: "rw" }])
    .withEnvironment({
      USER_NAME: "open",
      USER_PASSWORD: "openpass",
      PASSWORD_ACCESS: "true",
      SUDO_ACCESS: "false",
    })
    .withExposedPorts(2222)
    .withWaitStrategy(Wait.forLogMessage("sshd is listening on port 2222"))
    .start()

  const connection = {
    host: container.getHost(),
    port: container.getMappedPort(2222),
    username: "open",
    password: "openpass",
  }

  try {
    await waitForSshReady(connection)
  } catch (error) {
    await container.stop().catch(() => undefined)
    await rm(seedDir, { recursive: true, force: true })
    throw error
  }

  return {
    connection,
    stop: async () => {
      await container.stop()
      await rm(seedDir, { recursive: true, force: true })
    },
  }
}
