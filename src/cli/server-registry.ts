import { createInterface } from "node:readline/promises"
import { stdin, stdout, stderr } from "node:process"
import { ensureRuntimeDirs, runtimePaths } from "../core/paths.js"
import { createKeychainSecretProvider } from "../core/registry/keychain-provider.js"
import { createServerRegistry, type ServerRecord, type ServerRegistry } from "../core/registry/server-registry.js"

type PromptAdapter = {
  text(message: string, defaultValue?: string): Promise<string>
  password(message: string): Promise<string>
  confirm(message: string, defaultValue?: boolean): Promise<boolean>
  close?(): Promise<void> | void
}

type WritableLike = {
  write(chunk: string): void
}

type CliDeps = {
  registry: Pick<ServerRegistry, "list" | "resolve" | "upsert" | "remove">
  prompt: PromptAdapter
  stdout: WritableLike
  stderr: WritableLike
}

const usage = [
  "Usage: bun run server-registry <add|list|remove>",
  "",
  "Commands:",
  "  add      interactively add or update a password-based server",
  "  list     print configured servers without secrets",
  "  remove   remove a configured server by id",
].join("\n")

const parseList = (input: string) => {
  const values = input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  return values.length === 0 ? undefined : values
}

const describeServer = (record: Pick<ServerRecord, "id" | "host" | "port" | "username">) =>
  `${record.id} (${record.host}:${record.port} as ${record.username})`

const createConsolePrompt = (): PromptAdapter => {
  const askText = async (message: string) => {
    const rl = createInterface({ input: stdin, output: stdout })
    try {
      return await rl.question(message)
    } finally {
      rl.close()
    }
  }

  return {
    async text(message, defaultValue) {
      const suffix = defaultValue === undefined ? "" : ` [${defaultValue}]`
      const answer = (await askText(`${message}${suffix}: `)).trim()
      return answer === "" ? (defaultValue ?? "") : answer
    },
    async password(message) {
      if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
        return askText(`${message}: `)
      }

      stdout.write(`${message}: `)
      stdin.resume()
      stdin.setEncoding("utf8")
      stdin.setRawMode(true)

      return await new Promise<string>((resolve, reject) => {
        let value = ""

        const cleanup = () => {
          stdin.off("data", onData)
          stdin.setRawMode(false)
          stdin.pause()
          stdout.write("\n")
        }

        const onData = (chunk: string | Buffer) => {
          const char = chunk.toString("utf8")
          if (char === "\u0003") {
            cleanup()
            reject(new Error("prompt cancelled"))
            return
          }

          if (char === "\r" || char === "\n") {
            cleanup()
            resolve(value)
            return
          }

          if (char === "\u007f" || char === "\b") {
            value = value.slice(0, -1)
            return
          }

          value += char
        }

        stdin.on("data", onData)
      })
    },
    async confirm(message, defaultValue = false) {
      const suffix = defaultValue ? " [Y/n]" : " [y/N]"

      while (true) {
        const answer = (await askText(`${message}${suffix}: `)).trim().toLowerCase()
        if (answer === "") {
          return defaultValue
        }
        if (answer === "y" || answer === "yes") {
          return true
        }
        if (answer === "n" || answer === "no") {
          return false
        }
      }
    },
  }
}

const createDefaultDeps = async (): Promise<CliDeps> => {
  await ensureRuntimeDirs()

  return {
    registry: createServerRegistry({
      registryFile: runtimePaths.registryFile,
      secretProvider: createKeychainSecretProvider(),
    }),
    prompt: createConsolePrompt(),
    stdout: { write: (chunk) => stdout.write(chunk) },
    stderr: { write: (chunk) => stderr.write(chunk) },
  }
}

const handleAdd = async (deps: CliDeps, idArg?: string) => {
  const id = await deps.prompt.text("Server id", idArg)
  if (!id) {
    deps.stderr.write("Server id is required.\n")
    return 1
  }

  const existing = await deps.registry.resolve(id)
  if (existing) {
    const overwrite = await deps.prompt.confirm(`Overwrite existing server ${describeServer(existing)}?`)
    if (!overwrite) {
      deps.stdout.write("Cancelled.\n")
      return 0
    }
  }

  const host = await deps.prompt.text("Host", existing?.host)
  const portRaw = await deps.prompt.text("Port", String(existing?.port ?? 22))
  const port = Number.parseInt(portRaw, 10)
  if (!Number.isInteger(port) || port <= 0) {
    deps.stderr.write(`Invalid port: ${portRaw}\n`)
    return 1
  }

  const username = await deps.prompt.text("Username", existing?.username)
  if (!username) {
    deps.stderr.write("Username is required.\n")
    return 1
  }

  const labels = parseList(await deps.prompt.text("Labels (comma-separated)", existing?.labels?.join(",") ?? ""))
  const groups = parseList(await deps.prompt.text("Groups (comma-separated)", existing?.groups?.join(",") ?? ""))
  const password = await deps.prompt.password("Password")
  if (!password) {
    deps.stderr.write("Password is required.\n")
    return 1
  }

  await deps.registry.upsert({
    id,
    host,
    port,
    username,
    ...(labels ? { labels } : {}),
    ...(groups ? { groups } : {}),
    auth: {
      kind: "password",
      secret: password,
    },
  })

  deps.stdout.write(`Saved server ${id} (${host}:${port}).\n`)
  return 0
}

const handleList = async (deps: CliDeps) => {
  const records = await deps.registry.list()
  if (records.length === 0) {
    deps.stdout.write("No servers configured.\n")
    return 0
  }

  deps.stdout.write("ID\tHOST\tPORT\tUSERNAME\tLABELS\tGROUPS\n")
  for (const record of records) {
    deps.stdout.write(
      [
        record.id,
        record.host,
        String(record.port),
        record.username,
        (record.labels ?? []).join(","),
        (record.groups ?? []).join(","),
      ].join("\t") + "\n",
    )
  }

  return 0
}

const handleRemove = async (deps: CliDeps, idArg?: string) => {
  const records = await deps.registry.list()
  if (records.length === 0) {
    deps.stdout.write("No servers configured.\n")
    return 0
  }

  const id = idArg ?? (await deps.prompt.text("Server id to remove"))
  if (!id) {
    deps.stderr.write("Server id is required.\n")
    return 1
  }

  const existing = await deps.registry.resolve(id)
  if (!existing) {
    deps.stderr.write(`Server ${id} not found.\n`)
    return 1
  }

  const confirmed = await deps.prompt.confirm(`Remove server ${describeServer(existing)}?`)
  if (!confirmed) {
    deps.stdout.write("Cancelled.\n")
    return 0
  }

  await deps.registry.remove(id)
  deps.stdout.write(`Removed server ${id}.\n`)
  return 0
}

export const runServerRegistryCli = async (argv: string[], deps?: CliDeps) => {
  const activeDeps = deps ?? (await createDefaultDeps())

  try {
    const [command, arg] = argv

    switch (command) {
      case "add":
        return await handleAdd(activeDeps, arg)
      case "list":
        return await handleList(activeDeps)
      case "remove":
        return await handleRemove(activeDeps, arg)
      default:
        activeDeps.stderr.write(`${usage}\n`)
        return 1
    }
  } finally {
    await activeDeps.prompt.close?.()
  }
}

export const main = async (argv: string[] = process.argv.slice(2)) => runServerRegistryCli(argv)
