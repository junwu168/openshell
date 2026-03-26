import { tool, type Plugin, type ToolContext } from "@opencode-ai/plugin"
import { createAuditLogStore } from "../core/audit/log-store"
import { createGitAuditRepo } from "../core/audit/git-audit-repo"
import { createOrchestrator } from "../core/orchestrator"
import { classifyRemoteExec } from "../core/policy"
import { ensureRuntimeDirs, runtimePaths, workspaceRegistryFile } from "../core/paths"
import { createServerRegistry } from "../core/registry/server-registry"
import { errorResult } from "../core/result"
import { createSshRuntime } from "../core/ssh/ssh-runtime"

const serialize = async <T>(result: Promise<T>) => JSON.stringify(await result)
type RuntimeDependencies = Parameters<typeof createOrchestrator>[0]
type OpenCodePluginOptions = {
  ensureRuntimeDirs?: () => Promise<void>
  createRuntimeDependencies?: (workspaceRoot?: string) => RuntimeDependencies
}

type ApprovalRequest = Parameters<ToolContext["ask"]>[0]

const approvalRejected = (toolId: string, server: string, error: unknown) =>
  JSON.stringify(
    errorResult({
      tool: toolId,
      server,
      code: "APPROVAL_REJECTED",
      message: error instanceof Error ? error.message : "approval rejected",
      execution: { attempted: false, completed: false },
      audit: { logWritten: false, snapshotStatus: "not-applicable" },
    }),
  )

const requestApproval = async (
  context: ToolContext,
  toolId: string,
  server: string,
  request: ApprovalRequest | null,
) => {
  if (!request) {
    return null
  }

  try {
    await context.ask(request)
    return null
  } catch (error) {
    return approvalRejected(toolId, server, error)
  }
}

const createEditApproval = (
  toolId: "remote_write_file" | "remote_patch_file",
  input: { server: string; path: string; mode?: number; patch?: string; content?: string },
): ApprovalRequest => ({
  permission: "edit",
  patterns: [input.path],
  always: [],
  metadata: {
    tool: toolId,
    server: input.server,
    path: input.path,
    mode: input.mode,
    contentBytes: input.content ? Buffer.byteLength(input.content) : undefined,
    patchBytes: input.patch ? Buffer.byteLength(input.patch) : undefined,
  },
})

const createRemoteExecApproval = (input: {
  server: string
  command: string
  cwd?: string
  timeout?: number
}): ApprovalRequest | null => {
  const classification = classifyRemoteExec(input.command)
  if (classification.decision !== "approval-required") {
    return null
  }

  return {
    permission: "bash",
    patterns: [input.command],
    always: [],
    metadata: {
      tool: "remote_exec",
      server: input.server,
      command: input.command,
      cwd: input.cwd,
      timeout: input.timeout,
      reason: classification.reason,
    },
  }
}

const createTools = (orchestrator: ReturnType<typeof createOrchestrator>) => ({
  list_servers: tool({
    description: "List configured remote servers.",
    args: {},
    execute: async () => serialize(orchestrator.listServers()),
  }),
  remote_exec: tool({
    description: "Execute a shell command on a remote server.",
    args: {
      server: tool.schema.string(),
      command: tool.schema.string(),
      cwd: tool.schema.string().optional(),
      timeout: tool.schema.number().int().positive().optional(),
    },
    execute: async ({ server, command, cwd, timeout }, context) => {
      const rejected = await requestApproval(
        context,
        "remote_exec",
        server,
        createRemoteExecApproval({ server, command, cwd, timeout }),
      )
      if (rejected) {
        return rejected
      }

      return serialize(orchestrator.remoteExec({ server, command, cwd, timeout }))
    },
  }),
  remote_read_file: tool({
    description: "Read a remote file.",
    args: {
      server: tool.schema.string(),
      path: tool.schema.string(),
      offset: tool.schema.number().int().nonnegative().optional(),
      length: tool.schema.number().int().positive().optional(),
    },
    execute: async ({ server, path, offset, length }) =>
      serialize(orchestrator.remoteReadFile({ server, path, offset, length })),
  }),
  remote_write_file: tool({
    description: "Write content to a remote file.",
    args: {
      server: tool.schema.string(),
      path: tool.schema.string(),
      content: tool.schema.string(),
      mode: tool.schema.number().int().positive().optional(),
    },
    execute: async ({ server, path, content, mode }, context) => {
      const rejected = await requestApproval(
        context,
        "remote_write_file",
        server,
        createEditApproval("remote_write_file", { server, path, content, mode }),
      )
      if (rejected) {
        return rejected
      }

      return serialize(orchestrator.remoteWriteFile({ server, path, content, mode }))
    },
  }),
  remote_patch_file: tool({
    description: "Apply a unified diff to a remote file.",
    args: {
      server: tool.schema.string(),
      path: tool.schema.string(),
      patch: tool.schema.string(),
    },
    execute: async ({ server, path, patch }, context) => {
      const rejected = await requestApproval(
        context,
        "remote_patch_file",
        server,
        createEditApproval("remote_patch_file", { server, path, patch }),
      )
      if (rejected) {
        return rejected
      }

      return serialize(orchestrator.remotePatchFile({ server, path, patch }))
    },
  }),
  remote_list_dir: tool({
    description: "List a remote directory.",
    args: {
      server: tool.schema.string(),
      path: tool.schema.string(),
      recursive: tool.schema.boolean().optional(),
      limit: tool.schema.number().int().positive().optional(),
    },
    execute: async ({ server, path, recursive, limit }) =>
      serialize(orchestrator.remoteListDir({ server, path, recursive, limit })),
  }),
  remote_stat: tool({
    description: "Stat a remote path.",
    args: {
      server: tool.schema.string(),
      path: tool.schema.string(),
    },
    execute: async ({ server, path }) => serialize(orchestrator.remoteStat({ server, path })),
  }),
  remote_find: tool({
    description: "Search a remote directory for matching files or content.",
    args: {
      server: tool.schema.string(),
      path: tool.schema.string(),
      pattern: tool.schema.string(),
      glob: tool.schema.string().optional(),
      limit: tool.schema.number().int().positive().optional(),
    },
    execute: async ({ server, path, pattern, glob, limit }) =>
      serialize(orchestrator.remoteFind({ server, path, pattern, glob, limit })),
  }),
})

const buildRuntimeDependencies = (workspaceRoot: string): RuntimeDependencies => {
  const registry = createServerRegistry({
    globalRegistryFile: runtimePaths.globalRegistryFile,
    workspaceRegistryFile: workspaceRegistryFile(workspaceRoot),
    workspaceRoot,
  })
  const auditLog = createAuditLogStore(runtimePaths.auditLogFile)
  const auditRepo = createGitAuditRepo(runtimePaths.auditRepoDir)

  return {
    registry,
    ssh: createSshRuntime(),
    audit: {
      preflightLog: () => auditLog.preflight(),
      appendLog: (entry) => auditLog.append(entry),
      preflightSnapshots: () => auditRepo.preflight(),
      captureSnapshots: (input) => auditRepo.captureChange(input),
    },
  }
}

export const createOpenCodePlugin = (options: OpenCodePluginOptions = {}): Plugin => async (input) => {
  await (options.ensureRuntimeDirs ?? ensureRuntimeDirs)()

  const orchestrator = createOrchestrator(
    (options.createRuntimeDependencies ?? buildRuntimeDependencies)(input.worktree),
  )

  return {
    tool: createTools(orchestrator),
  }
}

export const OpenCodePlugin: Plugin = createOpenCodePlugin()
