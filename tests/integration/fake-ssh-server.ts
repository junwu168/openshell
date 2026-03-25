import { GenericContainer, Wait } from "testcontainers"

export const startFakeSshServer = async () => {
  const container = await new GenericContainer("linuxserver/openssh-server:latest")
    .withEnvironment({
      USER_NAME: "open",
      USER_PASSWORD: "openpass",
      PASSWORD_ACCESS: "true",
      SUDO_ACCESS: "false",
    })
    .withExposedPorts(2222)
    .withWaitStrategy(Wait.forLogMessage("sshd is listening on port 2222"))
    .start()

  return {
    connection: {
      host: container.getHost(),
      port: container.getMappedPort(2222),
      username: "open",
      password: "openpass",
    },
    stop: () => container.stop(),
  }
}
