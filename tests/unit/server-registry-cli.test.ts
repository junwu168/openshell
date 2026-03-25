import { describe, expect, test } from "bun:test"
import type { ServerRecord } from "../../src/core/registry/server-registry"

const promptSymbol = Symbol("prompt")

type PromptCall = {
  kind: "text" | "password" | "confirm"
  message: string
  defaultValue?: string | boolean
}

const createInMemoryRegistry = (records: ServerRecord[] = []) => {
  const state = new Map(records.map((record) => [record.id, record] as const))

  return {
    async list() {
      return [...state.values()]
    },
    async resolve(id: string) {
      return state.get(id) ?? null
    },
    async upsert(record: ServerRecord) {
      state.set(record.id, record)
    },
    async remove(id: string) {
      return state.delete(id)
    },
  }
}

const createPrompt = (answers: Array<string | boolean>) => {
  const calls: PromptCall[] = []
  let index = 0

  return {
    [promptSymbol]: calls,
    async text(message: string, defaultValue?: string) {
      calls.push({ kind: "text", message, defaultValue })
      return String(answers[index++] ?? "")
    },
    async password(message: string) {
      calls.push({ kind: "password", message })
      return String(answers[index++] ?? "")
    },
    async confirm(message: string, defaultValue = false) {
      calls.push({ kind: "confirm", message, defaultValue })
      return Boolean(answers[index++] ?? false)
    },
  }
}

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

describe("server registry cli", () => {
  test("adds a password-backed server interactively", async () => {
    const { runServerRegistryCli } = await import("../../src/cli/server-registry")
    const registry = createInMemoryRegistry()
    const prompt = createPrompt(["prod-a", "10.0.0.10", "22", "root", "prod,critical", "edge", "super-secret"])
    const stdout = createWritable()
    const stderr = createWritable()

    await expect(
      runServerRegistryCli(["add"], {
        registry,
        prompt,
        stdout,
        stderr,
      }),
    ).resolves.toBe(0)

    expect(await registry.list()).toEqual([
      {
        id: "prod-a",
        host: "10.0.0.10",
        port: 22,
        username: "root",
        labels: ["prod", "critical"],
        groups: ["edge"],
        auth: { kind: "password", secret: "super-secret" },
      },
    ])
    expect(stdout.toString()).toContain("Saved server prod-a")
    expect(stderr.toString()).toBe("")
  })

  test("lists configured servers without printing secrets", async () => {
    const { runServerRegistryCli } = await import("../../src/cli/server-registry")
    const registry = createInMemoryRegistry([
      {
        id: "prod-a",
        host: "10.0.0.10",
        port: 22,
        username: "root",
        labels: ["prod"],
        groups: ["edge"],
        auth: { kind: "password", secret: "super-secret" },
      },
    ])
    const stdout = createWritable()
    const stderr = createWritable()

    await expect(
      runServerRegistryCli(["list"], {
        registry,
        prompt: createPrompt([]),
        stdout,
        stderr,
      }),
    ).resolves.toBe(0)

    expect(stdout.toString()).toContain("prod-a")
    expect(stdout.toString()).toContain("10.0.0.10")
    expect(stdout.toString()).not.toContain("super-secret")
    expect(stderr.toString()).toBe("")
  })

  test("removes a server after interactive confirmation", async () => {
    const { runServerRegistryCli } = await import("../../src/cli/server-registry")
    const registry = createInMemoryRegistry([
      {
        id: "prod-a",
        host: "10.0.0.10",
        port: 22,
        username: "root",
        auth: { kind: "password", secret: "super-secret" },
      },
    ])
    const prompt = createPrompt(["prod-a", true])
    const stdout = createWritable()
    const stderr = createWritable()

    await expect(
      runServerRegistryCli(["remove"], {
        registry,
        prompt,
        stdout,
        stderr,
      }),
    ).resolves.toBe(0)

    expect(await registry.list()).toEqual([])
    expect(stdout.toString()).toContain("Removed server prod-a")
    expect(stderr.toString()).toBe("")
  })

  test("asks for overwrite confirmation before replacing an existing server id", async () => {
    const { runServerRegistryCli } = await import("../../src/cli/server-registry")
    const registry = createInMemoryRegistry([
      {
        id: "prod-a",
        host: "10.0.0.10",
        port: 22,
        username: "root",
        auth: { kind: "password", secret: "old-secret" },
      },
    ])
    const prompt = createPrompt(["prod-a", true, "10.0.0.20", "2222", "deploy", "", "", "new-secret"])
    const stdout = createWritable()

    await expect(
      runServerRegistryCli(["add"], {
        registry,
        prompt,
        stdout,
        stderr: createWritable(),
      }),
    ).resolves.toBe(0)

    expect(await registry.resolve("prod-a")).toEqual({
      id: "prod-a",
      host: "10.0.0.20",
      port: 2222,
      username: "deploy",
      auth: { kind: "password", secret: "new-secret" },
    })
    expect((prompt as Record<symbol, PromptCall[]>)[promptSymbol]).toContainEqual(
      expect.objectContaining({
        kind: "confirm",
        message: expect.stringContaining("Overwrite existing server prod-a"),
      }),
    )
  })
})
