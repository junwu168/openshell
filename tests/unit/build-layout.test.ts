import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

describe("build layout", () => {
  test("emits the package entry at dist/index.js", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"))
    const tsconfig = JSON.parse(await readFile(new URL("../../tsconfig.json", import.meta.url), "utf8"))

    expect(packageJson.exports["."].default).toBe("./dist/index.js")
    expect(tsconfig.compilerOptions.rootDir).toBe("src")
  })
})
