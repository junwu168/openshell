import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createAuditLogStore } from "../../src/core/audit/log-store"
import { createGitAuditRepo } from "../../src/core/audit/git-audit-repo"
import { redactSecrets } from "../../src/core/audit/redact"

const runGit = async (cwd: string, args: string[]) => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const exitCode = await proc.exited
  if (exitCode !== 0) throw new Error(await new Response(proc.stderr).text())
  return (await new Response(proc.stdout).text()).trim()
}

const exists = async (path: string) => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

describe("audit engine", () => {
  test("preflight prepares the audit log target", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-code-audit-preflight-"))
    const file = join(dir, "actions.jsonl")
    const store = createAuditLogStore(file)

    await store.preflight()

    const pathStat = await stat(file)
    expect(pathStat.isFile()).toBe(true)
  })

  test("redacts secret-looking values before writing JSONL entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-code-audit-"))
    const store = createAuditLogStore(join(dir, "actions.jsonl"))
    await store.preflight()
    await store.append({ command: "psql postgresql://user:secret@db/app" })
    const disk = await readFile(join(dir, "actions.jsonl"), "utf8")
    expect(disk.includes("secret")).toBe(false)
  })

  test("preserves trailing non-secret query data when redacting key/value values", () => {
    expect(redactSecrets("token=abc&mode=ro")).toBe("token=[REDACTED]&mode=ro")
  })

  test("stamps a fresh timestamp even when the entry includes one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-code-audit-timestamp-"))
    const file = join(dir, "actions.jsonl")
    const store = createAuditLogStore(file)

    await store.preflight()
    await store.append({ timestamp: "1999-01-01T00:00:00.000Z", command: "whoami" })

    const [disk] = (await readFile(file, "utf8")).trim().split("\n")
    const entry = JSON.parse(disk) as { timestamp: string; command: string }

    expect(entry.timestamp).not.toBe("1999-01-01T00:00:00.000Z")
    expect(entry.command).toBe("whoami")
  })

  test("keeps traversal inputs inside the audit repo", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "open-code-git-audit-traversal-"))
    const repoDir = join(tempRoot, "repo")
    const repo = createGitAuditRepo(repoDir)

    await repo.preflight()
    await repo.captureChange({
      server: "../escape",
      path: "/loot",
      before: "before\n",
      after: "after\n",
    })

    expect(await exists(join(tempRoot, "escape", "loot.before"))).toBe(false)
    expect(await exists(join(tempRoot, "escape", "loot.after"))).toBe(false)

    let foundAuditArtifact = false
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const child = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(child)
        } else if (entry.name.endsWith(".before") || entry.name.endsWith(".after")) {
          foundAuditArtifact = true
        }
      }
    }
    await walk(repoDir)

    expect(foundAuditArtifact).toBe(true)
  })

  test("stages only the current snapshot artifacts", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "open-code-git-audit-stage-"))
    const repoDir = join(tempRoot, "repo")
    const repo = createGitAuditRepo(repoDir)

    await repo.preflight()
    await Bun.write(join(repoDir, "unrelated.txt"), "keep-out\n")
    await repo.captureChange({
      server: "prod-a",
      path: "/etc/app.conf",
      before: "port=80\n",
      after: "port=81\n",
    })

    const files = await runGit(repoDir, ["show", "--pretty=format:", "--name-only", "HEAD"])
    expect(files.includes("unrelated.txt")).toBe(false)
  })

  test("encodes distinct logical targets into distinct repo paths", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "open-code-git-audit-unique-"))
    const repoDir = join(tempRoot, "repo")
    const repo = createGitAuditRepo(repoDir)

    await repo.preflight()
    await repo.captureChange({
      server: "prod:a",
      path: "/etc/a?b",
      before: "one\n",
      after: "two\n",
    })
    await repo.captureChange({
      server: "prod/a",
      path: "/etc/a:b",
      before: "three\n",
      after: "four\n",
    })

    let artifactCount = 0
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const child = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(child)
        } else if (entry.name.endsWith(".before") || entry.name.endsWith(".after")) {
          artifactCount++
        }
      }
    }
    await walk(repoDir)

    expect(artifactCount).toBe(4)
  })

  test("keeps hostile path segments inside the repo and distinct", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "open-code-git-audit-hostile-"))
    const repoDir = join(tempRoot, "repo")
    const repo = createGitAuditRepo(repoDir)

    await repo.preflight()
    await repo.captureChange({
      server: "../escape",
      path: "/../loot?mode=ro",
      before: "before\n",
      after: "after\n",
    })

    expect(await exists(join(tempRoot, "escape"))).toBe(false)

    let artifactCount = 0
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const child = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(child)
        } else if (entry.name.endsWith(".before") || entry.name.endsWith(".after")) {
          artifactCount++
        }
      }
    }
    await walk(repoDir)

    expect(artifactCount).toBe(2)
  })

  test("records repeated identical captures as distinct commits", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "open-code-git-audit-repeat-"))
    const repoDir = join(tempRoot, "repo")
    const repo = createGitAuditRepo(repoDir)

    await repo.preflight()
    await repo.captureChange({
      server: "prod-a",
      path: "/etc/app.conf",
      before: "port=80\n",
      after: "port=81\n",
    })

    const firstCount = await runGit(repoDir, ["rev-list", "--count", "HEAD"])

    await repo.captureChange({
      server: "prod-a",
      path: "/etc/app.conf",
      before: "port=80\n",
      after: "port=81\n",
    })

    const secondCount = await runGit(repoDir, ["rev-list", "--count", "HEAD"])

    expect(firstCount).toBe("1")
    expect(secondCount).toBe("2")
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
