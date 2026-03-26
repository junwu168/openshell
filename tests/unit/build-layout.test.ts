import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

describe("build layout", () => {
  test("package metadata no longer declares keytar", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"))

    expect(packageJson.dependencies.keytar).toBeUndefined()
  })

  test("package metadata publishes openshell with a bin entry", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"))

    expect(packageJson.name).toBe("@junwu168/openshell")
    expect(packageJson.private).not.toBe(true)
    expect(packageJson.bin).toEqual({
      openshell: "./dist/cli/openshell.js",
    })
  })

  test("emits the package entry at dist/index.js", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"))
    const tsconfig = JSON.parse(await readFile(new URL("../../tsconfig.json", import.meta.url), "utf8"))

    expect(packageJson.exports["."].default).toBe("./dist/index.js")
    expect(tsconfig.compilerOptions.rootDir).toBe("src")
  })
})
