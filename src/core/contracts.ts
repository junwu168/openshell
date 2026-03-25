export type ServerID = string

export type ApprovalDecision = "allow" | "deny"
export type PolicyDecision = "auto-allow" | "approval-required" | "reject"

export type ToolStatus = "ok" | "partial_failure" | "error"

export interface ToolPayload<TData = unknown> {
  tool: string
  server?: ServerID
  data?: TData
  message?: string
  code?: string
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
