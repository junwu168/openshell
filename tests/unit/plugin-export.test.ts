import { describe, expect, test } from "bun:test"
import { OpenCodePlugin } from "../../src/index"

describe("package entry", () => {
  test("exports the OpenCode plugin factory", () => {
    expect(typeof OpenCodePlugin).toBe("function")
  })
})
