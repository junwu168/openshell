import { describe, expect, test } from "bun:test"
import { errorResult, okResult, partialFailureResult } from "../../src/core/result"

describe("tool result helpers", () => {
  test("builds success payloads", () => {
    expect(
      okResult({
        tool: "list_servers",
        data: [],
        execution: { attempted: true, completed: true },
        audit: { logWritten: true, snapshotStatus: "not-applicable" },
      }).status,
    ).toBe("ok")
  })

  test("builds partial-failure payloads", () => {
    expect(
      partialFailureResult({
        tool: "remote_write_file",
        message: "remote write succeeded but git commit failed",
      }).status,
    ).toBe("partial_failure")
  })

  test("builds hard-error payloads", () => {
    expect(errorResult({ tool: "remote_exec", code: "POLICY_REJECTED" }).status).toBe("error")
  })
})
