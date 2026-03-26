import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("workspace tracker", () => {
  test("records and deduplicates managed workspaces", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "openshell-workspace-tracker-"))
    tempDirs.push(tempDir)
    const trackerFile = join(tempDir, "workspaces.json")
    const { createWorkspaceTracker } = await import("../../src/product/workspace-tracker")
    const tracker = createWorkspaceTracker(trackerFile)

    await tracker.record({
      workspaceRoot: "/repo",
      managedPath: "/repo/.open-code",
    })
    await tracker.record({
      workspaceRoot: "/repo",
      managedPath: "/repo/.open-code",
    })

    expect(await tracker.list()).toEqual([
      expect.objectContaining({
        workspaceRoot: "/repo",
        managedPath: "/repo/.open-code",
      }),
    ])
  })

  test("persists tracker state as json", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "openshell-workspace-tracker-"))
    tempDirs.push(tempDir)
    const trackerFile = join(tempDir, "workspaces.json")
    const { createWorkspaceTracker } = await import("../../src/product/workspace-tracker")
    const tracker = createWorkspaceTracker(trackerFile)

    await tracker.record({
      workspaceRoot: "/repo",
      managedPath: "/repo/.open-code",
    })

    const raw = JSON.parse(await readFile(trackerFile, "utf8"))
    expect(raw).toEqual([
      expect.objectContaining({
        workspaceRoot: "/repo",
        managedPath: "/repo/.open-code",
      }),
    ])
  })
})
