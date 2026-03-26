import { describe, expect, test } from "bun:test"
import OpenShellPlugin, { OpenCodePlugin, OpenShellPlugin as NamedOpenShellPlugin } from "@junwu168/openshell"

describe("package entry", () => {
  test("exports the OpenShell plugin factory", () => {
    expect(typeof OpenShellPlugin).toBe("function")
    expect(typeof NamedOpenShellPlugin).toBe("function")
    expect(typeof OpenCodePlugin).toBe("function")
  })
})
