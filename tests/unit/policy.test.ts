import { describe, expect, test } from "bun:test"
import { classifyRemoteExec } from "../../src/core/policy"

describe("remote exec policy", () => {
  test("auto-allows simple linux inspection commands", () => {
    expect(classifyRemoteExec("cat /etc/hosts").decision).toBe("auto-allow")
  })

  test("requires approval for middleware commands", () => {
    expect(classifyRemoteExec("kubectl get pods -A").decision).toBe("approval-required")
  })

  test("requires approval for shell composition", () => {
    expect(classifyRemoteExec("cat /etc/hosts | grep localhost").decision).toBe("approval-required")
  })

  test("rejects empty commands", () => {
    expect(classifyRemoteExec("   ").decision).toBe("reject")
  })
})
