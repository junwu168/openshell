import { readFileSync } from "node:fs"
import type { ConnectConfig } from "ssh2"
import type { PolicyDecision, ToolPayload, ToolResult } from "./contracts"
import { applyUnifiedPatch } from "./patch"
import { classifyRemoteExec } from "./policy"
import { errorResult, okResult, partialFailureResult } from "./result"
import type { ServerRecord, ServerRegistry } from "./registry/server-registry"

type ExecResult = {
  stdout: string
  stderr: string
  exitCode: number
}

type SshRuntime = {
  exec(connection: ConnectConfig, command: string, options?: { cwd?: string; timeout?: number }): Promise<ExecResult>
  readFile(connection: ConnectConfig, path: string): Promise<string>
  writeFile(connection: ConnectConfig, path: string, content: string, mode?: number): Promise<void>
  listDir(connection: ConnectConfig, path: string, recursive?: boolean, limit?: number): Promise<
    { name: string; longname: string }[] | string[]
  >
  stat(connection: ConnectConfig, path: string): Promise<{
    size: number
    mode: number
    isFile: boolean
    isDirectory: boolean
  }>
}

type AuditEngine = {
  preflightLog(): Promise<void>
  appendLog(entry: Record<string, unknown>): Promise<void>
  preflightSnapshots?(): Promise<void>
  captureSnapshots?(input: { server: string; path: string; before: string; after: string }): Promise<void>
}

type PolicyEngine = {
  classifyRemoteExec(command: string): {
    decision: PolicyDecision
    reason: string
  }
}

type OrchestratorOptions = {
  registry: Pick<ServerRegistry, "list" | "resolve">
  ssh: SshRuntime
  audit: AuditEngine
  policy?: PolicyEngine
}

type RemoteExecInput = {
  server: string
  command: string
  cwd?: string
  timeout?: number
}

type RemoteReadFileInput = {
  server: string
  path: string
  offset?: number
  length?: number
}

type RemoteWriteFileInput = {
  server: string
  path: string
  content: string
  mode?: number
}

type RemotePatchFileInput = {
  server: string
  path: string
  patch: string
}

type RemoteListDirInput = {
  server: string
  path: string
  recursive?: boolean
  limit?: number
}

type RemoteStatInput = {
  server: string
  path: string
}

type RemoteFindInput = {
  server: string
  path: string
  pattern: string
  glob?: string
  limit?: number
}

const quoteShell = (value: string) => `'${value.replaceAll("'", `'\"'\"'`)}'`

const toConnectConfig = (server: ServerRecord): ConnectConfig => {
  const base = {
    host: server.host,
    port: server.port,
    username: server.username,
  }

  switch (server.auth.kind) {
    case "password":
      return {
        ...base,
        password: server.auth.secret,
      }
    case "privateKey":
      return {
        ...base,
        privateKey: readFileSync(server.auth.privateKeyPath, "utf8"),
      }
    case "certificate":
      return {
        ...base,
        privateKey: readFileSync(server.auth.privateKeyPath, "utf8"),
      }
  }
}

const withAuditFlag = <T>(
  status: "ok" | "partial_failure" | "error",
  payload: ToolPayload<T>,
  logWritten: boolean,
): ToolResult<T> => {
  const next: ToolPayload<T> = {
    ...payload,
    audit: {
      logWritten,
      snapshotStatus: payload.audit?.snapshotStatus ?? "not-applicable",
    },
  }

  if (status === "ok") {
    return okResult(next)
  }

  if (status === "partial_failure") {
    return partialFailureResult(next)
  }

  return errorResult(next)
}

const byteLength = (value: string) => Buffer.byteLength(value)
const clampLimit = (value: number | undefined, fallback: number) => Math.max(1, Math.trunc(value ?? fallback))

export const createOrchestrator = ({ registry, ssh, audit, policy = { classifyRemoteExec } }: OrchestratorOptions) => {
  const appendLogSafe = async (entry: Record<string, unknown>) => {
    try {
      await audit.appendLog(entry)
      return true
    } catch {
      return false
    }
  }

  const preflightLog = async <T>(tool: string, server?: string): Promise<ToolResult<T> | null> => {
    try {
      await audit.preflightLog()
      return null
    } catch (error) {
      return errorResult({
        tool,
        server,
        code: "AUDIT_LOG_PREFLIGHT_FAILED",
        message: (error as Error).message,
        execution: { attempted: false, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      })
    }
  }

  const resolveServer = async <T>(
    tool: string,
    serverId: string,
    logEntry: Record<string, unknown>,
    approvalStatus: string,
  ): Promise<{ result: ToolResult<T> | null; server: ServerRecord | null }> => {
    let server: ServerRecord | null
    try {
      server = await registry.resolve(serverId)
    } catch (error) {
      const payload: ToolPayload<T> = {
        tool,
        server: serverId,
        code: "SERVER_RESOLVE_FAILED",
        message: (error as Error).message,
        execution: { attempted: false, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }

      const logWritten = await appendLogSafe({
        ...logEntry,
        tool,
        server: serverId,
        approvalStatus,
        code: "SERVER_RESOLVE_FAILED",
        message: payload.message,
      })

      return {
        result: withAuditFlag("error", payload, logWritten),
        server: null,
      }
    }

    if (!server) {
      const payload: ToolPayload<T> = {
        tool,
        server: serverId,
        code: "SERVER_NOT_FOUND",
        execution: { attempted: false, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }

      const logWritten = await appendLogSafe({
        ...logEntry,
        tool,
        server: serverId,
        approvalStatus,
        code: "SERVER_NOT_FOUND",
      })

      return {
        result: withAuditFlag("error", payload, logWritten),
        server: null,
      }
    }

    return {
      result: null,
      server,
    }
  }

  const listServers = async (): Promise<ToolResult<Array<Omit<ServerRecord, "auth">>>> => {
    const logReady = await preflightLog<Array<Omit<ServerRecord, "auth">>>("list_servers")
    if (logReady) {
      return logReady
    }

    try {
      const servers = await registry.list()
      const data = servers.map(({ auth: _auth, ...server }) => server)
      const payload: ToolPayload<Array<Omit<ServerRecord, "auth">>> = {
        tool: "list_servers",
        data,
        execution: { attempted: true, completed: true },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "list_servers",
        approvalStatus: "not-required",
        count: data.length,
      })
      return withAuditFlag("ok", payload, logWritten)
    } catch (error) {
      const payload: ToolPayload<Array<Omit<ServerRecord, "auth">>> = {
        tool: "list_servers",
        code: "REGISTRY_LIST_FAILED",
        message: (error as Error).message,
        execution: { attempted: false, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "list_servers",
        approvalStatus: "not-required",
        code: "REGISTRY_LIST_FAILED",
        message: payload.message,
      })
      return withAuditFlag("error", payload, logWritten)
    }
  }

  const remoteExec = async (input: RemoteExecInput): Promise<ToolResult<ExecResult>> => {
    const logReady = await preflightLog<ExecResult>("remote_exec", input.server)
    if (logReady) {
      return logReady
    }

    const classification = policy.classifyRemoteExec(input.command)
    const approvalStatus =
      classification.decision === "approval-required" ? "host-managed-required" : "not-required"

    const resolved = await resolveServer(
      "remote_exec",
      input.server,
      { command: input.command, cwd: input.cwd, timeout: input.timeout },
      "unknown",
    )
    if (resolved.result) {
      return resolved.result as ToolResult<ExecResult>
    }

    if (classification.decision === "reject") {
      const payload: ToolPayload<ExecResult> = {
        tool: "remote_exec",
        server: input.server,
        code: "POLICY_REJECTED",
        message: classification.reason,
        execution: { attempted: false, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_exec",
        server: input.server,
        command: input.command,
        cwd: input.cwd,
        timeout: input.timeout,
        approvalStatus: "not-required",
        code: "POLICY_REJECTED",
        message: classification.reason,
      })
      return withAuditFlag("error", payload, logWritten)
    }

    try {
      const executed = await ssh.exec(toConnectConfig(resolved.server!), input.command, {
        cwd: input.cwd,
        timeout: input.timeout,
      })
      const payload: ToolPayload<ExecResult> = {
        tool: "remote_exec",
        server: input.server,
        data: executed,
        execution: {
          attempted: true,
          completed: true,
          exitCode: executed.exitCode,
          stdoutBytes: byteLength(executed.stdout),
          stderrBytes: byteLength(executed.stderr),
        },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_exec",
        server: input.server,
        command: input.command,
        cwd: input.cwd,
        timeout: input.timeout,
        approvalStatus,
        policyDecision: classification.decision,
        approvalRequired: classification.decision === "approval-required",
        ...executed,
      })
      return withAuditFlag("ok", payload, logWritten)
    } catch (error) {
      const payload: ToolPayload<ExecResult> = {
        tool: "remote_exec",
        server: input.server,
        code: "SSH_EXEC_FAILED",
        message: (error as Error).message,
        execution: { attempted: true, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_exec",
        server: input.server,
        command: input.command,
        cwd: input.cwd,
        timeout: input.timeout,
        approvalStatus,
        code: "SSH_EXEC_FAILED",
        message: payload.message,
      })
      return withAuditFlag("error", payload, logWritten)
    }
  }

  const remoteReadFile = async (input: RemoteReadFileInput): Promise<ToolResult<{ content: string }>> => {
    const logReady = await preflightLog<{ content: string }>("remote_read_file", input.server)
    if (logReady) {
      return logReady
    }

    const resolved = await resolveServer(
      "remote_read_file",
      input.server,
      { path: input.path, offset: input.offset, length: input.length },
      "not-required",
    )
    if (resolved.result) {
      return resolved.result as ToolResult<{ content: string }>
    }

    try {
      const body = await ssh.readFile(toConnectConfig(resolved.server!), input.path)
      const offset = input.offset ?? 0
      const content = body.slice(offset, input.length ? offset + input.length : undefined)
      const payload: ToolPayload<{ content: string }> = {
        tool: "remote_read_file",
        server: input.server,
        data: { content },
        execution: { attempted: true, completed: true },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_read_file",
        server: input.server,
        path: input.path,
        offset: input.offset,
        length: input.length,
        approvalStatus: "not-required",
      })
      return withAuditFlag("ok", payload, logWritten)
    } catch (error) {
      const payload: ToolPayload<{ content: string }> = {
        tool: "remote_read_file",
        server: input.server,
        code: "SSH_READ_FAILED",
        message: (error as Error).message,
        execution: { attempted: true, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_read_file",
        server: input.server,
        path: input.path,
        approvalStatus: "not-required",
        code: "SSH_READ_FAILED",
        message: payload.message,
      })
      return withAuditFlag("error", payload, logWritten)
    }
  }

  const remoteWriteFile = async (input: RemoteWriteFileInput): Promise<ToolResult> => {
    const logReady = await preflightLog("remote_write_file", input.server)
    if (logReady) {
      return logReady
    }

    const resolved = await resolveServer(
      "remote_write_file",
      input.server,
      { path: input.path, mode: input.mode },
      "host-managed-required",
    )
    if (resolved.result) {
      return resolved.result
    }

    try {
      await (audit.preflightSnapshots?.() ?? Promise.resolve())
    } catch (error) {
      const payload: ToolPayload<ExecResult> = {
        tool: "remote_write_file",
        server: input.server,
        code: "AUDIT_SNAPSHOT_PREFLIGHT_FAILED",
        message: (error as Error).message,
        execution: { attempted: false, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_write_file",
        server: input.server,
        path: input.path,
        mode: input.mode,
        approvalStatus: "host-managed-required",
        code: "AUDIT_SNAPSHOT_PREFLIGHT_FAILED",
        message: payload.message,
      })
      return withAuditFlag("error", payload, logWritten)
    }

    const connection = toConnectConfig(resolved.server!)
    const before = await ssh.readFile(connection, input.path).catch(() => "")
    try {
      await ssh.writeFile(connection, input.path, input.content, input.mode)
    } catch (error) {
      const payload: ToolPayload<{ name: string; longname: string }[] | string[]> = {
        tool: "remote_write_file",
        server: input.server,
        code: "SSH_WRITE_FAILED",
        message: (error as Error).message,
        execution: { attempted: true, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_write_file",
        server: input.server,
        path: input.path,
        mode: input.mode,
        approvalStatus: "host-managed-required",
        approvalRequired: true,
        code: "SSH_WRITE_FAILED",
        message: payload.message,
      })
      return withAuditFlag("error", payload, logWritten)
    }

    const after = await ssh.readFile(connection, input.path).catch(() => input.content)
    const logWritten = await appendLogSafe({
      tool: "remote_write_file",
      server: input.server,
      path: input.path,
      mode: input.mode,
      changedPath: input.path,
      approvalStatus: "host-managed-required",
      approvalRequired: true,
    })

    try {
      await (audit.captureSnapshots?.({ server: input.server, path: input.path, before, after }) ?? Promise.resolve())
      const payload: ToolPayload<{ name: string; longname: string }[] | string[]> = {
        tool: "remote_write_file",
        server: input.server,
        execution: { attempted: true, completed: true },
        audit: { logWritten: false, snapshotStatus: "written" },
      }
      if (!logWritten) {
        return withAuditFlag(
          "partial_failure",
          {
            ...payload,
            message: "remote write succeeded but audit log write failed",
            audit: { logWritten: false, snapshotStatus: "written" },
          },
          false,
        )
      }
      return withAuditFlag("ok", payload, true)
    } catch (error) {
      return withAuditFlag(
        "partial_failure",
        {
          tool: "remote_write_file",
          server: input.server,
          message: `remote write succeeded but audit finalization failed: ${(error as Error).message}`,
          execution: { attempted: true, completed: true },
          audit: { logWritten: false, snapshotStatus: "partial-failure" },
        },
        logWritten,
      )
    }
  }

  const remotePatchFile = async (input: RemotePatchFileInput): Promise<ToolResult> => {
    const logReady = await preflightLog("remote_patch_file", input.server)
    if (logReady) {
      return logReady
    }

    const resolved = await resolveServer(
      "remote_patch_file",
      input.server,
      { path: input.path },
      "host-managed-required",
    )
    if (resolved.result) {
      return resolved.result
    }

    let before: string
    try {
      before = await ssh.readFile(toConnectConfig(resolved.server!), input.path)
    } catch (error) {
      const payload: ToolPayload<{ size: number; mode: number; isFile: boolean; isDirectory: boolean }> = {
        tool: "remote_patch_file",
        server: input.server,
        code: "SSH_READ_FAILED",
        message: (error as Error).message,
        execution: { attempted: true, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_patch_file",
        server: input.server,
        path: input.path,
        approvalStatus: "host-managed-required",
        code: "SSH_READ_FAILED",
        message: payload.message,
      })
      return withAuditFlag("error", payload, logWritten)
    }

    let after: string
    try {
      after = applyUnifiedPatch(before, input.patch)
    } catch (error) {
      const payload: ToolPayload<{ name: string; longname: string }[] | string[]> = {
        tool: "remote_patch_file",
        server: input.server,
        code: "PATCH_APPLY_FAILED",
        message: (error as Error).message,
        execution: { attempted: false, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_patch_file",
        server: input.server,
        path: input.path,
        approvalStatus: "host-managed-required",
        code: "PATCH_APPLY_FAILED",
        message: payload.message,
      })
      return withAuditFlag("error", payload, logWritten)
    }

    try {
      await (audit.preflightSnapshots?.() ?? Promise.resolve())
    } catch (error) {
      const payload: ToolPayload<{ size: number; mode: number; isFile: boolean; isDirectory: boolean }> = {
        tool: "remote_patch_file",
        server: input.server,
        code: "AUDIT_SNAPSHOT_PREFLIGHT_FAILED",
        message: (error as Error).message,
        execution: { attempted: false, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_patch_file",
        server: input.server,
        path: input.path,
        approvalStatus: "host-managed-required",
        code: "AUDIT_SNAPSHOT_PREFLIGHT_FAILED",
        message: payload.message,
      })
      return withAuditFlag("error", payload, logWritten)
    }

    try {
      await ssh.writeFile(toConnectConfig(resolved.server!), input.path, after)
    } catch (error) {
      const payload: ToolPayload<ExecResult> = {
        tool: "remote_patch_file",
        server: input.server,
        code: "SSH_WRITE_FAILED",
        message: (error as Error).message,
        execution: { attempted: true, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_patch_file",
        server: input.server,
        path: input.path,
        approvalStatus: "host-managed-required",
        approvalRequired: true,
        code: "SSH_WRITE_FAILED",
        message: payload.message,
      })
      return withAuditFlag("error", payload, logWritten)
    }

    const logWritten = await appendLogSafe({
      tool: "remote_patch_file",
      server: input.server,
      path: input.path,
      changedPath: input.path,
      approvalStatus: "host-managed-required",
      approvalRequired: true,
    })

    try {
      await (audit.captureSnapshots?.({ server: input.server, path: input.path, before, after }) ?? Promise.resolve())
      const payload: ToolPayload<{ name: string; longname: string }[] | string[]> = {
        tool: "remote_patch_file",
        server: input.server,
        execution: { attempted: true, completed: true },
        audit: { logWritten: false, snapshotStatus: "written" },
      }
      if (!logWritten) {
        return withAuditFlag(
          "partial_failure",
          {
            ...payload,
            message: "remote patch succeeded but audit log write failed",
            audit: { logWritten: false, snapshotStatus: "written" },
          },
          false,
        )
      }
      return withAuditFlag("ok", payload, true)
    } catch (error) {
      return withAuditFlag(
        "partial_failure",
        {
          tool: "remote_patch_file",
          server: input.server,
          message: `remote patch succeeded but audit finalization failed: ${(error as Error).message}`,
          execution: { attempted: true, completed: true },
          audit: { logWritten: false, snapshotStatus: "partial-failure" },
        },
        logWritten,
      )
    }
  }

  const remoteListDir = async (
    input: RemoteListDirInput,
  ): Promise<ToolResult<{ name: string; longname: string }[] | string[]>> => {
    const logReady = await preflightLog<{ name: string; longname: string }[] | string[]>("remote_list_dir", input.server)
    if (logReady) {
      return logReady
    }

    const resolved = await resolveServer(
      "remote_list_dir",
      input.server,
      { path: input.path, recursive: input.recursive, limit: input.limit },
      "not-required",
    )
    if (resolved.result) {
      return resolved.result as ToolResult<{ name: string; longname: string }[] | string[]>
    }

    try {
      const entries = await ssh.listDir(
        toConnectConfig(resolved.server!),
        input.path,
        input.recursive ?? false,
        input.limit ?? 200,
      )
      const payload: ToolPayload<{ name: string; longname: string }[] | string[]> = {
        tool: "remote_list_dir",
        server: input.server,
        data: entries,
        execution: { attempted: true, completed: true },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_list_dir",
        server: input.server,
        path: input.path,
        recursive: input.recursive ?? false,
        limit: input.limit ?? 200,
        approvalStatus: "not-required",
      })
      return withAuditFlag("ok", payload, logWritten)
    } catch (error) {
      const payload: ToolPayload<{ name: string; longname: string }[] | string[]> = {
        tool: "remote_list_dir",
        server: input.server,
        code: "SSH_LIST_FAILED",
        message: (error as Error).message,
        execution: { attempted: true, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_list_dir",
        server: input.server,
        path: input.path,
        approvalStatus: "not-required",
        code: "SSH_LIST_FAILED",
        message: payload.message,
      })
      return withAuditFlag("error", payload, logWritten)
    }
  }

  const remoteStat = async (
    input: RemoteStatInput,
  ): Promise<ToolResult<{ size: number; mode: number; isFile: boolean; isDirectory: boolean }>> => {
    const logReady = await preflightLog<{ size: number; mode: number; isFile: boolean; isDirectory: boolean }>(
      "remote_stat",
      input.server,
    )
    if (logReady) {
      return logReady
    }

    const resolved = await resolveServer("remote_stat", input.server, { path: input.path }, "not-required")
    if (resolved.result) {
      return resolved.result as ToolResult<{ size: number; mode: number; isFile: boolean; isDirectory: boolean }>
    }

    try {
      const stat = await ssh.stat(toConnectConfig(resolved.server!), input.path)
      const payload: ToolPayload<typeof stat> = {
        tool: "remote_stat",
        server: input.server,
        data: stat,
        execution: { attempted: true, completed: true },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_stat",
        server: input.server,
        path: input.path,
        approvalStatus: "not-required",
      })
      return withAuditFlag("ok", payload, logWritten)
    } catch (error) {
      const payload: ToolPayload<{ size: number; mode: number; isFile: boolean; isDirectory: boolean }> = {
        tool: "remote_stat",
        server: input.server,
        code: "SSH_STAT_FAILED",
        message: (error as Error).message,
        execution: { attempted: true, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_stat",
        server: input.server,
        path: input.path,
        approvalStatus: "not-required",
        code: "SSH_STAT_FAILED",
        message: payload.message,
      })
      return withAuditFlag("error", payload, logWritten)
    }
  }

  const remoteFind = async (input: RemoteFindInput): Promise<ToolResult<ExecResult>> => {
    const logReady = await preflightLog<ExecResult>("remote_find", input.server)
    if (logReady) {
      return logReady
    }

    const resolved = await resolveServer(
      "remote_find",
      input.server,
      { path: input.path, pattern: input.pattern, glob: input.glob, limit: input.limit },
      "not-required",
    )
    if (resolved.result) {
      return resolved.result as ToolResult<ExecResult>
    }

    const limit = clampLimit(input.limit, 200)
    const command = input.glob
      ? `find ${quoteShell(input.path)} -name ${quoteShell(input.glob)} | head -n ${limit}`
      : `grep -R -n ${quoteShell(input.pattern)} ${quoteShell(input.path)} | head -n ${limit}`

    try {
      const executed = await ssh.exec(toConnectConfig(resolved.server!), command)
      const payload: ToolPayload<ExecResult> = {
        tool: "remote_find",
        server: input.server,
        data: executed,
        execution: {
          attempted: true,
          completed: true,
          exitCode: executed.exitCode,
          stdoutBytes: byteLength(executed.stdout),
          stderrBytes: byteLength(executed.stderr),
        },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_find",
        server: input.server,
        command,
        approvalStatus: "not-required",
        ...executed,
      })
      return withAuditFlag("ok", payload, logWritten)
    } catch (error) {
      const payload: ToolPayload<ExecResult> = {
        tool: "remote_find",
        server: input.server,
        code: "SSH_FIND_FAILED",
        message: (error as Error).message,
        execution: { attempted: true, completed: false },
        audit: { logWritten: false, snapshotStatus: "not-applicable" },
      }
      const logWritten = await appendLogSafe({
        tool: "remote_find",
        server: input.server,
        command,
        approvalStatus: "not-required",
        code: "SSH_FIND_FAILED",
        message: payload.message,
      })
      return withAuditFlag("error", payload, logWritten)
    }
  }

  return {
    listServers,
    remoteExec,
    remoteReadFile,
    remoteWriteFile,
    remotePatchFile,
    remoteListDir,
    remoteStat,
    remoteFind,
  }
}
