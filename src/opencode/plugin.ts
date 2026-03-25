import { tool, type Plugin } from "@opencode-ai/plugin"
import { createAuditLogStore } from "../core/audit/log-store"
import { createGitAuditRepo } from "../core/audit/git-audit-repo"
import { createOrchestrator } from "../core/orchestrator"
import { ensureRuntimeDirs, runtimePaths } from "../core/paths"
import { createKeychainSecretProvider } from "../core/registry/keychain-provider"
import { createServerRegistry } from "../core/registry/server-registry"
import { createSshRuntime } from "../core/ssh/ssh-runtime"

const serialize = async <T>(result: Promise<T>) => JSON.stringify(await result)

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
    execute: async ({ server, command, cwd, timeout }) =>
      serialize(orchestrator.remoteExec({ server, command, cwd, timeout })),
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
    execute: async ({ server, path, content, mode }) =>
      serialize(orchestrator.remoteWriteFile({ server, path, content, mode })),
  }),
  remote_patch_file: tool({
    description: "Apply a unified diff to a remote file.",
    args: {
      server: tool.schema.string(),
      path: tool.schema.string(),
      patch: tool.schema.string(),
    },
    execute: async ({ server, path, patch }) =>
      serialize(orchestrator.remotePatchFile({ server, path, patch })),
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

export const OpenCodePlugin: Plugin = async () => {
  await ensureRuntimeDirs()

  const registry = createServerRegistry({
    registryFile: runtimePaths.registryFile,
    secretProvider: createKeychainSecretProvider(),
  })
  const auditLog = createAuditLogStore(runtimePaths.auditLogFile)
  const auditRepo = createGitAuditRepo(runtimePaths.auditRepoDir)
  const orchestrator = createOrchestrator({
    registry,
    ssh: createSshRuntime(),
    audit: {
      preflightLog: () => auditLog.preflight(),
      appendLog: (entry) => auditLog.append(entry),
      preflightSnapshots: () => auditRepo.preflight(),
      captureSnapshots: (input) => auditRepo.captureChange(input),
    },
  })

  return {
    tool: createTools(orchestrator),
  }
}
