import { Client, type ConnectConfig } from "ssh2"
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
  const container = await new GenericContainer(SSH_IMAGE)
    .withCopyContentToContainer([
      {
        content: [
          "#!/usr/bin/env sh",
          "set -eu",
          "",
          "mkdir -p /tmp/open-code",
          "chmod 1777 /tmp/open-code",
          "cat <<'EOF' >/tmp/open-code/hosts",
          "127.0.0.1 localhost",
          "EOF",
          "cat <<'EOF' >/tmp/open-code/app.conf",
          "port=80",
          "EOF",
          "chown open:open /tmp/open-code/hosts /tmp/open-code/app.conf",
          "chmod 0644 /tmp/open-code/hosts /tmp/open-code/app.conf",
          "",
        ].join("\n"),
        target: "/custom-cont-init.d/10-seed-open-code.sh",
        mode: 0o755,
      },
    ])
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
    throw error
  }

  return {
    connection,
    stop: () => container.stop(),
  }
}
