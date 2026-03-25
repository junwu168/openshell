import type { ToolPayload, ToolResult } from "./contracts"

export const okResult = <T>(payload: ToolPayload<T>): ToolResult<T> => ({
  status: "ok",
  ...payload,
})

export const partialFailureResult = <T>(payload: ToolPayload<T>): ToolResult<T> => ({
  status: "partial_failure",
  ...payload,
})

export const errorResult = <T>(payload: ToolPayload<T>): ToolResult<T> => ({
  status: "error",
  ...payload,
})
