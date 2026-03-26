import { access } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import { stderr, stdin, stdout } from "node:process"
import { ensureRuntimeDirs, runtimePaths, workspaceRegistryFile } from "../core/paths.js"
import {
  createServerRegistry,
  type RegistryScope,
  type ResolvedServerRecord,
  type ServerRecord,
  type ServerRegistry,
} from "../core/registry/server-registry.js"

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
  registry: Pick<ServerRegistry, "list" | "resolve" | "listRaw" | "upsert" | "remove">
  prompt: PromptAdapter
  stdout: WritableLike
  stderr: WritableLike
  workspaceRoot: string
}

const usage = [
  "Usage: bun run server-registry <add|list|remove>",
  "",
  "Commands:",
  "  add      interactively add or update a server across workspace/global scopes",
  "  list     print configured servers with scope metadata",
  "  remove   remove a configured server by id and scope",
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
  const workspaceRoot = process.cwd()

  return {
    registry: createServerRegistry({
      globalRegistryFile: runtimePaths.globalRegistryFile,
      workspaceRegistryFile: workspaceRegistryFile(workspaceRoot),
      workspaceRoot,
    }),
    prompt: createConsolePrompt(),
    stdout: { write: (chunk) => stdout.write(chunk) },
    stderr: { write: (chunk) => stderr.write(chunk) },
    workspaceRoot,
  }
}

const getRawRecord = async (registry: CliDeps["registry"], scope: RegistryScope, id: string) =>
  (await registry.listRaw(scope)).find((record) => record.id === id) ?? null

const workspaceScopeExists = async (workspaceRoot: string) => {
  try {
    await access(workspaceRegistryFile(workspaceRoot))
    return true
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false
    }

    throw error
  }
}

const promptScope = async (
  deps: CliDeps,
  message: string,
  defaultScope: RegistryScope,
): Promise<RegistryScope | null> => {
  const answer = (await deps.prompt.text(message, defaultScope)).trim().toLowerCase()
  if (answer === "") {
    return defaultScope
  }

  if (answer === "global" || answer === "g") {
    return "global"
  }

  if (answer === "workspace" || answer === "w") {
    return "workspace"
  }

  deps.stderr.write(`Invalid scope: ${answer}\n`)
  return null
}

const promptAuthKind = async (
  deps: CliDeps,
  defaultKind: ServerRecord["auth"]["kind"] = "password",
): Promise<ServerRecord["auth"]["kind"] | null> => {
  const answer = (await deps.prompt.text("Auth kind (password/privateKey/certificate)", defaultKind)).trim()
  if (answer === "") {
    return defaultKind
  }

  switch (answer.toLowerCase()) {
    case "password":
      return "password"
    case "privatekey":
      return "privateKey"
    case "certificate":
      return "certificate"
    default:
      deps.stderr.write(`Invalid auth kind: ${answer}\n`)
      return null
  }
}

const promptAuth = async (
  deps: CliDeps,
  kind: ServerRecord["auth"]["kind"],
  existingAuth?: ServerRecord["auth"],
): Promise<ServerRecord["auth"] | null> => {
  if (kind === "password") {
    const secret = await deps.prompt.password("Password")
    if (!secret) {
      deps.stderr.write("Password is required.\n")
      return null
    }

    deps.stdout.write("Warning: plain-text password will be stored as-is.\n")
    return { kind, secret }
  }

  if (kind === "privateKey") {
    const privateKeyPath = await deps.prompt.text("Private key path", existingAuth?.kind === "privateKey" ? existingAuth.privateKeyPath : undefined)
    if (!privateKeyPath) {
      deps.stderr.write("Private key path is required.\n")
      return null
    }

    const passphrase = (await deps.prompt.text(
      "Passphrase (optional)",
      existingAuth && "passphrase" in existingAuth ? existingAuth.passphrase ?? "" : "",
    )).trim()

    return {
      kind,
      privateKeyPath,
      ...(passphrase ? { passphrase } : {}),
    } as ServerRecord["auth"]
  }

  const certificatePath = await deps.prompt.text(
    "Certificate path",
    existingAuth?.kind === "certificate" ? existingAuth.certificatePath : undefined,
  )
  if (!certificatePath) {
    deps.stderr.write("Certificate path is required.\n")
    return null
  }

  const privateKeyPath = await deps.prompt.text(
    "Private key path",
    existingAuth?.kind === "certificate" ? existingAuth.privateKeyPath : undefined,
  )
  if (!privateKeyPath) {
    deps.stderr.write("Private key path is required.\n")
    return null
  }

  const passphrase = (await deps.prompt.text(
    "Passphrase (optional)",
    existingAuth && "passphrase" in existingAuth ? existingAuth.passphrase ?? "" : "",
  )).trim()

  return {
    kind,
    certificatePath,
    privateKeyPath,
    ...(passphrase ? { passphrase } : {}),
  } as ServerRecord["auth"]
}

const handleAdd = async (deps: CliDeps, idArg?: string) => {
  const id = await deps.prompt.text("Server id", idArg)
  if (!id) {
    deps.stderr.write("Server id is required.\n")
    return 1
  }

  const defaultScope = (await workspaceScopeExists(deps.workspaceRoot)) ? "workspace" : "global"
  const scope = await promptScope(deps, "Server scope (global/workspace)", defaultScope)
  if (!scope) {
    return 1
  }

  const existing = await getRawRecord(deps.registry, scope, id)
  const resolvedExisting = await deps.registry.resolve(id)

  if (existing) {
    const overwrite = await deps.prompt.confirm(`Overwrite existing server ${describeServer(existing)}?`)
    if (!overwrite) {
      deps.stdout.write("Cancelled.\n")
      return 0
    }
  }

  if (scope === "workspace" && resolvedExisting?.scope === "global") {
    deps.stdout.write(
      `Warning: workspace record ${id} will override global entry ${describeServer(resolvedExisting)}.\n`,
    )
  }

  const host = await deps.prompt.text("Host", existing?.host ?? resolvedExisting?.host)
  if (!host) {
    deps.stderr.write("Host is required.\n")
    return 1
  }

  const portRaw = await deps.prompt.text("Port", String(existing?.port ?? resolvedExisting?.port ?? 22))
  const port = Number.parseInt(portRaw, 10)
  if (!Number.isInteger(port) || port <= 0) {
    deps.stderr.write(`Invalid port: ${portRaw}\n`)
    return 1
  }

  const username = await deps.prompt.text("Username", existing?.username ?? resolvedExisting?.username)
  if (!username) {
    deps.stderr.write("Username is required.\n")
    return 1
  }

  const labels = parseList(
    await deps.prompt.text("Labels (comma-separated)", existing?.labels?.join(",") ?? resolvedExisting?.labels?.join(",") ?? ""),
  )
  const groups = parseList(
    await deps.prompt.text("Groups (comma-separated)", existing?.groups?.join(",") ?? resolvedExisting?.groups?.join(",") ?? ""),
  )

  const authKind = await promptAuthKind(deps, existing?.auth.kind ?? resolvedExisting?.auth.kind ?? "password")
  if (!authKind) {
    return 1
  }

  const auth = await promptAuth(deps, authKind, existing?.auth ?? resolvedExisting?.auth)
  if (!auth) {
    return 1
  }

  await deps.registry.upsert(scope, {
    id,
    host,
    port,
    username,
    ...(labels ? { labels } : {}),
    ...(groups ? { groups } : {}),
    auth,
  } as ServerRecord)

  deps.stdout.write(`Saved server ${id} (${host}:${port}).\n`)
  return 0
}

const handleList = async (deps: CliDeps) => {
  const records = await deps.registry.list()
  if (records.length === 0) {
    deps.stdout.write("No servers configured.\n")
    return 0
  }

  deps.stdout.write("ID\tSCOPE\tSTATUS\tHOST\tPORT\tUSERNAME\tLABELS\tGROUPS\n")
  for (const record of records as ResolvedServerRecord[]) {
    deps.stdout.write(
      [
        record.id,
        record.scope,
        record.shadowingGlobal ? "shadowing global" : "",
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
  const id = idArg ?? (await deps.prompt.text("Server id to remove"))
  if (!id) {
    deps.stderr.write("Server id is required.\n")
    return 1
  }

  const [globalRecord, workspaceRecord] = await Promise.all([
    getRawRecord(deps.registry, "global", id),
    getRawRecord(deps.registry, "workspace", id),
  ])

  if (!globalRecord && !workspaceRecord) {
    deps.stderr.write(`Server ${id} not found.\n`)
    return 1
  }

  let scope: RegistryScope
  if (globalRecord && workspaceRecord) {
    const defaultScope = workspaceRecord ? "workspace" : "global"
    const selectedScope = await promptScope(deps, "Remove from which scope (global/workspace)", defaultScope)
    if (!selectedScope) {
      return 1
    }

    scope = selectedScope
  } else {
    scope = workspaceRecord ? "workspace" : "global"
  }

  const existing = scope === "workspace" ? workspaceRecord : globalRecord
  if (!existing) {
    deps.stderr.write(`Server ${id} not found in ${scope}.\n`)
    return 1
  }

  const confirmed = await deps.prompt.confirm(`Remove server ${describeServer(existing)}?`)
  if (!confirmed) {
    deps.stdout.write("Cancelled.\n")
    return 0
  }

  const removed = await deps.registry.remove(scope, id)
  if (!removed) {
    deps.stderr.write(`Server ${id} not found in ${scope}.\n`)
    return 1
  }

  deps.stdout.write(`Removed server ${id} from ${scope}.\n`)
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
