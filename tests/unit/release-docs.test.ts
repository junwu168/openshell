import { describe, expect, test } from "bun:test"
import { access, readFile } from "node:fs/promises"

const exists = async (path: string) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe("release docs", () => {
  test("README documents the npm install and uninstall flow", async () => {
    const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8")

    expect(readme).toContain("npm install -g @junwu168/openshell")
    expect(readme).toContain("openshell install")
    expect(readme).toContain("openshell server-registry add")
    expect(readme).toContain("openshell uninstall")
    expect(readme).toContain("opencode")
  })

  test("legacy local plugin shim is not part of the release example", async () => {
    expect(
      await exists(
        new URL("../../examples/opencode-local/.opencode/plugins/open-code.ts", import.meta.url).pathname,
      ),
    ).toBe(false)
  })
})
