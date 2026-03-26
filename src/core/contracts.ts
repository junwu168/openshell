export type ServerID = string

export type ApprovalDecision = "allow" | "deny"
export type PolicyDecision = "auto-allow" | "approval-required" | "reject"
export type ToolErrorCode =
  | "APPROVAL_REJECTED"
  | "AUDIT_LOG_PREFLIGHT_FAILED"
  | "AUDIT_SNAPSHOT_PREFLIGHT_FAILED"
  | "AUTH_PATH_INVALID"
  | "AUTH_PATH_UNREADABLE"
  | "CERTIFICATE_PATH_NOT_FOUND"
  | "KEY_PATH_NOT_FOUND"
  | "PATCH_APPLY_FAILED"
  | "POLICY_REJECTED"
  | "REGISTRY_LIST_FAILED"
  | "SERVER_NOT_FOUND"
  | "SERVER_RESOLVE_FAILED"
  | "SSH_EXEC_FAILED"
  | "SSH_FIND_FAILED"
  | "SSH_LIST_FAILED"
  | "SSH_READ_FAILED"
  | "SSH_STAT_FAILED"
  | "SSH_WRITE_FAILED"

export type ToolStatus = "ok" | "partial_failure" | "error"

export interface ToolPayload<TData = unknown> {
  tool: string
  server?: ServerID
  data?: TData
  message?: string
  code?: ToolErrorCode
  execution?: {
    attempted: boolean
    completed: boolean
    exitCode?: number
    stdoutBytes?: number
    stderrBytes?: number
    stdoutTruncated?: boolean
    stderrTruncated?: boolean
  }
  audit?: {
    logWritten: boolean
    snapshotStatus: "not-applicable" | "written" | "partial-failure"
  }
}

export interface ToolResult<TData = unknown> extends ToolPayload<TData> {
  status: ToolStatus
}
