import { Shescape } from "shescape"
import { Client, type ConnectConfig } from "ssh2"

const shell = new Shescape({ shell: "zsh" })

type ExecOptions = {
  cwd?: string
  timeout?: number
}

type ExecResult = {
  stdout: string
  stderr: string
  exitCode: number
}

type DirEntry = {
  name: string
  longname: string
}

type PathStat = {
  size: number
  mode: number
  isFile: boolean
  isDirectory: boolean
}

const withClient = <T>(connection: ConnectConfig, action: (client: Client) => Promise<T>) =>
  new Promise<T>((resolve, reject) => {
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
      .on("ready", () => {
        action(client).then(
          (result) => finish(() => resolve(result)),
          (error) => finish(() => reject(error)),
        )
      })
      .on("error", (error) => finish(() => reject(error)))
      .connect(connection)
  })

export const createSshRuntime = () => {
  const exec = (connection: ConnectConfig, command: string, options: ExecOptions = {}) =>
    withClient<ExecResult>(connection, (client) =>
      new Promise((resolve, reject) => {
        const effective = options.cwd ? `cd ${shell.quote(options.cwd)} && ${command}` : command
        let settled = false
        let streamRef: {
          signal: (signalName: string) => void
          close: () => void
        } | null = null

        const finish = (handler: () => void) => {
          if (settled) {
            return
          }

          settled = true

          if (timer) {
            clearTimeout(timer)
          }

          handler()
        }

        const timer =
          options.timeout === undefined
            ? null
            : setTimeout(() => {
                if (streamRef) {
                  try {
                    streamRef.signal("SIGKILL")
                  } catch {}

                  try {
                    streamRef.close()
                  } catch {}
                }

                finish(() => reject(new Error(`command timed out after ${options.timeout}ms`)))
              }, options.timeout)

        client.exec(effective, (error, stream) => {
          if (error) {
            finish(() => reject(error))
            return
          }

          streamRef = stream

          let stdout = ""
          let stderr = ""
          let exitCode = 0

          stream.on("data", (chunk: Buffer | string) => {
            stdout += chunk.toString()
          })

          stream.stderr.on("data", (chunk: Buffer | string) => {
            stderr += chunk.toString()
          })

          stream.on("exit", (code) => {
            exitCode = code ?? 0
          })

          stream.on("close", () => {
            finish(() => resolve({ stdout, stderr, exitCode }))
          })

          stream.on("error", (streamError: Error) => {
            finish(() => reject(streamError))
          })
        })
      }),
    )

  const readFile = (connection: ConnectConfig, path: string) =>
    withClient<string>(connection, (client) =>
      new Promise((resolve, reject) => {
        client.sftp((error, sftp) => {
          if (error) {
            reject(error)
            return
          }

          const chunks: Buffer[] = []
          const stream = sftp.createReadStream(path)

          stream.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.from(chunk))
          })
          stream.on("error", reject)
          stream.on("close", () => {
            resolve(Buffer.concat(chunks).toString("utf8"))
          })
        })
      }),
    )

  const writeFile = (connection: ConnectConfig, path: string, content: string, mode?: number) =>
    withClient<void>(connection, (client) =>
      new Promise((resolve, reject) => {
        client.sftp((error, sftp) => {
          if (error) {
            reject(error)
            return
          }

          const stream = sftp.createWriteStream(path, mode === undefined ? undefined : { mode })

          stream.on("error", reject)
          stream.on("close", () => resolve())
          stream.end(content)
        })
      }),
    )

  const listDir = async (connection: ConnectConfig, path: string, recursive = false, limit = 200) => {
    if (recursive) {
      const listed = await exec(connection, `find ${shell.quote(path)} -print`)

      if (listed.exitCode !== 0) {
        throw new Error(listed.stderr.trim() || `remote find failed for ${path}`)
      }

      return listed.stdout.trim().split("\n").filter(Boolean).slice(0, Math.max(1, limit))
    }

    return withClient<DirEntry[]>(connection, (client) =>
      new Promise((resolve, reject) => {
        client.sftp((error, sftp) => {
          if (error) {
            reject(error)
            return
          }

          sftp.readdir(path, (readError, entries) => {
            if (readError) {
              reject(readError)
              return
            }

            resolve(entries.map((entry) => ({ name: entry.filename, longname: entry.longname })))
          })
        })
      }),
    )
  }

  const stat = (connection: ConnectConfig, path: string) =>
    withClient<PathStat>(connection, (client) =>
      new Promise((resolve, reject) => {
        client.sftp((error, sftp) => {
          if (error) {
            reject(error)
            return
          }

          sftp.stat(path, (statError, stats) => {
            if (statError) {
              reject(statError)
              return
            }

            resolve({
              size: stats.size,
              mode: stats.mode,
              isFile: stats.isFile(),
              isDirectory: stats.isDirectory(),
            })
          })
        })
      }),
    )

  return { exec, readFile, writeFile, listDir, stat }
}
