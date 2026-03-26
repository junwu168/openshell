import { constants as osConstants } from "node:os"
import { Shescape } from "shescape"
import { Client, type ConnectConfig } from "ssh2"

const shell = new Shescape({ shell: "zsh" })
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000

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

type RuntimeOptions = {
  operationTimeoutMs?: number
}

const normalizeShellPath = (path: string) => (path.startsWith("-") ? `./${path}` : path)
const quoteShellPath = (path: string) => shell.quote(normalizeShellPath(path))
const clampLimit = (limit: number) => Math.max(0, Math.trunc(limit))
const joinRemotePath = (parent: string, name: string) => (parent.endsWith("/") ? `${parent}${name}` : `${parent}/${name}`)
const signalToExitCode = (signal: string | null | undefined) => {
  if (!signal) {
    return 0
  }

  const normalized = signal.startsWith("SIG") ? signal : `SIG${signal}`
  const signalNumber = osConstants.signals[normalized as keyof typeof osConstants.signals]

  return signalNumber === undefined ? 1 : 128 + signalNumber
}

const withClient = <T>(
  connection: ConnectConfig,
  action: (client: Client) => Promise<T>,
  timeoutMs: number | null = null,
) =>
  new Promise<T>((resolve, reject) => {
    const client = new Client()
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (handler: () => void, close: () => void = () => client.end()) => {
      if (settled) {
        return
      }

      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      handler()
      close()
    }

    if (timeoutMs !== null) {
      timer = setTimeout(() => {
        finish(() => reject(new Error(`ssh operation timed out after ${timeoutMs}ms`)), () => client.destroy())
      }, timeoutMs)
    }

    client
      .on("ready", () => {
        action(client).then(
          (result) => finish(() => resolve(result)),
          (error) => finish(() => reject(error)),
        )
      })
      .on("error", (error) => finish(() => reject(error)))
      .connect(timeoutMs === null ? connection : { ...connection, readyTimeout: connection.readyTimeout ?? timeoutMs })
  })

export const createSshRuntime = (options: RuntimeOptions = {}) => {
  const operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS

  const exec = (connection: ConnectConfig, command: string, options: ExecOptions = {}) =>
    withClient<ExecResult>(connection, (client) =>
      new Promise((resolve, reject) => {
        const effective = options.cwd ? `cd -- ${quoteShellPath(options.cwd)} && ${command}` : command
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

          stream.on("exit", (code: number | null, signal: string | null) => {
            exitCode = code ?? signalToExitCode(signal)
          })

          stream.on("close", () => {
            finish(() => resolve({ stdout, stderr, exitCode }))
          })

          stream.on("error", (streamError: Error) => {
            finish(() => reject(streamError))
          })
        })
      }),
      null,
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
      operationTimeoutMs,
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
      operationTimeoutMs,
    )

  const listDir = async (connection: ConnectConfig, path: string, recursive = false, limit = 200) => {
    const boundedLimit = clampLimit(limit)

    if (boundedLimit === 0) {
      return []
    }

    if (recursive) {
      return withClient<string[]>(connection, (client) =>
        new Promise((resolve, reject) => {
          client.sftp((error, sftp) => {
            if (error) {
              reject(error)
              return
            }

            const statPath = (target: string) =>
              new Promise<any>((resolvePath, rejectPath) => {
                sftp.stat(target, (statError, stats) => {
                  if (statError) {
                    rejectPath(statError)
                    return
                  }

                  resolvePath(stats)
                })
              })

            const readDir = (target: string) =>
              new Promise<any[]>((resolvePath, rejectPath) => {
                sftp.readdir(target, (readError, entries) => {
                  if (readError) {
                    rejectPath(readError)
                    return
                  }

                  resolvePath(entries)
                })
              })

            const visit = async (target: string, output: string[]) => {
              if (output.length >= boundedLimit) {
                return
              }

              output.push(target)

              if (output.length >= boundedLimit) {
                return
              }

              const targetStats = await statPath(target)
              if (!targetStats.isDirectory()) {
                return
              }

              const entries = await readDir(target)

              for (const entry of entries) {
                if (entry.filename === "." || entry.filename === "..") {
                  continue
                }

                const fullPath = joinRemotePath(target, entry.filename)

                if (entry.attrs.isDirectory()) {
                  await visit(fullPath, output)
                } else if (output.length < boundedLimit) {
                  output.push(fullPath)
                }

                if (output.length >= boundedLimit) {
                  return
                }
              }
            }

            void (async () => {
              try {
                const output: string[] = []
                await visit(path, output)
                resolve(output)
              } catch (visitError) {
                reject(visitError)
              }
            })()
          })
        }),
        operationTimeoutMs,
      )
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

            resolve(entries.slice(0, boundedLimit).map((entry) => ({ name: entry.filename, longname: entry.longname })))
          })
        })
      }),
      operationTimeoutMs,
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
      operationTimeoutMs,
    )

  return { exec, readFile, writeFile, listDir, stat }
}
