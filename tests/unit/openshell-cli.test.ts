import { describe, expect, test } from "bun:test"

const createWritable = () => {
  let buffer = ""

  return {
    write(chunk: string) {
      buffer += chunk
    },
    toString() {
      return buffer
    },
  }
}

describe("openshell cli", () => {
  test("routes server-registry subcommands", async () => {
    const stdout = createWritable()
    const stderr = createWritable()
    const serverRegistryCalls: string[][] = []
    const { runOpenShellCli } = await import("../../src/cli/openshell")

    await expect(
      runOpenShellCli(["server-registry", "list"], {
        stdout,
        stderr,
        runServerRegistryCli: async (argv: string[]) => {
          serverRegistryCalls.push(argv)
          return 0
        },
      }),
    ).resolves.toBe(0)

    expect(serverRegistryCalls).toEqual([["list"]])
    expect(stdout.toString()).toBe("")
    expect(stderr.toString()).toBe("")
  })

  test("prints top-level usage with no args", async () => {
    const stdout = createWritable()
    const stderr = createWritable()
    const { runOpenShellCli } = await import("../../src/cli/openshell")

    await expect(runOpenShellCli([], { stdout, stderr })).resolves.toBe(0)

    expect(stdout.toString()).toContain("Usage: openshell")
    expect(stderr.toString()).toBe("")
  })

  test("returns non-zero for unknown subcommands", async () => {
    const stdout = createWritable()
    const stderr = createWritable()
    const { runOpenShellCli } = await import("../../src/cli/openshell")

    await expect(runOpenShellCli(["wat"], { stdout, stderr })).resolves.toBe(1)

    expect(stderr.toString()).toContain("Usage: openshell")
    expect(stdout.toString()).toBe("")
  })
})
