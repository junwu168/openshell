import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const run = async (cwd: string, args: string[]) => {
  const proc = Bun.spawn(["git", ...args], { cwd, stderr: "pipe", stdout: "pipe" })
  const exitCode = await proc.exited
  if (exitCode !== 0) throw new Error(await new Response(proc.stderr).text())
}

const encodeSegment = (segment: string) =>
  `s-${Buffer.from(segment, "utf8").toString("base64url")}`

const snapshotParts = (server: string, path: string) => [
  encodeSegment(server),
  ...path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeSegment),
]

export const createGitAuditRepo = (repoDir: string) => ({
  async preflight() {
    await mkdir(repoDir, { recursive: true })
    await run(repoDir, ["init"])
    await run(repoDir, ["config", "user.name", "Open Code"])
    await run(repoDir, ["config", "user.email", "open-code@local"])
  },
  async captureChange(input: { server: string; path: string; before: string; after: string }) {
    const parts = snapshotParts(input.server, input.path)
    const relativeBase = parts.join("/")
    const base = join(repoDir, ...parts)
    await mkdir(dirname(base), { recursive: true })
    await writeFile(`${base}.before`, input.before)
    await writeFile(`${base}.after`, input.after)
    await run(repoDir, ["add", "--", `${relativeBase}.before`, `${relativeBase}.after`])
    await run(repoDir, ["commit", "--allow-empty", "-m", `audit: ${input.server} ${input.path}`])
  },
  async lastCommitMessage() {
    const proc = Bun.spawn(["git", "log", "-1", "--pretty=%s"], { cwd: repoDir, stdout: "pipe" })
    return (await new Response(proc.stdout).text()).trim()
  },
})
