const SAFE_COMMANDS = new Set(["cat", "grep", "find", "ls", "pwd", "uname", "df", "free", "ps"])
const MIDDLEWARE_COMMANDS = new Set([
  "psql",
  "mysql",
  "redis-cli",
  "kubectl",
  "docker",
  "helm",
  "aws",
  "gcloud",
  "az",
])
const SHELL_META = ["|", ">", "<", ";", "&&", "||", "$(", "`"]

export const classifyRemoteExec = (command: string) => {
  const trimmed = command.trim()
  if (!trimmed) return { decision: "reject", reason: "empty command" } as const
  if (SHELL_META.some((token) => trimmed.includes(token))) {
    return { decision: "approval-required", reason: "shell composition" } as const
  }

  const [binary, subcommand] = trimmed.split(/\s+/)
  if (MIDDLEWARE_COMMANDS.has(binary)) {
    return { decision: "approval-required", reason: "middleware command" } as const
  }
  if (SAFE_COMMANDS.has(binary) || (binary === "systemctl" && subcommand === "status")) {
    return { decision: "auto-allow", reason: "safe inspection command" } as const
  }
  return { decision: "approval-required", reason: "unknown command" } as const
}
