import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createAuditLogStore } from "../../src/core/audit/log-store"
import { createGitAuditRepo } from "../../src/core/audit/git-audit-repo"

describe("audit engine", () => {
  test("redacts secret-looking values before writing JSONL entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-code-audit-"))
    const store = createAuditLogStore(join(dir, "actions.jsonl"))
    await store.preflight()
    await store.append({ command: "psql postgresql://user:secret@db/app" })
    const disk = await readFile(join(dir, "actions.jsonl"), "utf8")
    expect(disk.includes("secret")).toBe(false)
  })

  test("creates a git commit for before and after snapshots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-code-git-audit-"))
    const repo = createGitAuditRepo(dir)
    await repo.preflight()
    await repo.captureChange({
      server: "prod-a",
      path: "/etc/app.conf",
      before: "port=80\n",
      after: "port=81\n",
    })
    expect(await repo.lastCommitMessage()).toContain("prod-a")
  })
})
