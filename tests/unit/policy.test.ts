import { describe, expect, test } from "bun:test"
import { classifyRemoteExec } from "../../src/core/policy"

describe("remote exec policy", () => {
  test("auto-allows simple linux inspection commands", () => {
    expect(classifyRemoteExec("cat /etc/hosts")).toEqual({
      decision: "auto-allow",
      reason: "safe inspection command",
    })
  })

  test("requires approval for middleware commands", () => {
    expect(classifyRemoteExec("kubectl get pods -A")).toEqual({
      decision: "approval-required",
      reason: "middleware command",
    })
  })

  test("requires approval for shell composition", () => {
    expect(classifyRemoteExec("cat /etc/hosts | grep localhost")).toEqual({
      decision: "approval-required",
      reason: "shell composition",
    })
  })

  test("rejects empty commands", () => {
    expect(classifyRemoteExec("   ")).toEqual({
      decision: "reject",
      reason: "empty command",
    })
  })

  test("auto-allows systemctl status inspection", () => {
    expect(classifyRemoteExec("systemctl status nginx")).toEqual({
      decision: "auto-allow",
      reason: "safe inspection command",
    })
  })

  test("does not auto-allow systemctl statusx", () => {
    expect(classifyRemoteExec("systemctl statusx nginx")).toEqual({
      decision: "approval-required",
      reason: "unknown command",
    })
  })

  test("requires approval for unknown commands", () => {
    expect(classifyRemoteExec("uptime now")).toEqual({
      decision: "approval-required",
      reason: "unknown command",
    })
  })
})
