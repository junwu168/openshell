import { describe, expect, test } from "bun:test"
import { readFile, readdir } from "node:fs/promises"
import { join, relative } from "node:path"

const collectTsFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(entryPath)))
      continue
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath)
    }
  }

  return files
}

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

  test("package metadata publishes built artifacts and builds before pack", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"))

    expect(packageJson.files).toEqual(expect.arrayContaining(["dist"]))
    expect(packageJson.scripts.prepack).toBe("npm run build")
  })

  test("emits the package entry at dist/index.js", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"))
    const tsconfig = JSON.parse(await readFile(new URL("../../tsconfig.json", import.meta.url), "utf8"))

    expect(packageJson.exports["."].default).toBe("./dist/index.js")
    expect(tsconfig.compilerOptions.rootDir).toBe("src")
  })

  test("source relative imports use explicit .js extensions for Node ESM", async () => {
    const srcRoot = new URL("../../src", import.meta.url).pathname
    const sourceFiles = await collectTsFiles(srcRoot)
    const offenders: string[] = []

    for (const sourceFile of sourceFiles) {
      const content = await readFile(sourceFile, "utf8")
      const matches = content.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)

      for (const match of matches) {
        const specifier = match[1]
        if (!specifier.endsWith(".js")) {
          offenders.push(`${relative(srcRoot, sourceFile)} -> ${specifier}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
