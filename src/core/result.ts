import type { ToolPayload, ToolResult } from "./contracts"

export const okResult = <T>(payload: ToolPayload<T>): ToolResult<T> => ({
  ...payload,
  status: "ok",
})

export const partialFailureResult = <T>(payload: ToolPayload<T>): ToolResult<T> => ({
  ...payload,
  status: "partial_failure",
})

export const errorResult = <T>(payload: ToolPayload<T>): ToolResult<T> => ({
  ...payload,
  status: "error",
})
