import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type WorkspaceTrackerEntry = {
  workspaceRoot: string
  managedPath: string
}

export type WorkspaceTracker = {
  list(): Promise<WorkspaceTrackerEntry[]>
  record(entry: WorkspaceTrackerEntry): Promise<void>
  remove(workspaceRoot: string): Promise<void>
  clear(): Promise<void>
}

const readEntries = async (trackerFile: string): Promise<WorkspaceTrackerEntry[]> => {
  try {
    const raw = await readFile(trackerFile, "utf8")
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((entry): entry is WorkspaceTrackerEntry => {
      if (typeof entry !== "object" || entry === null) {
        return false
      }

      const candidate = entry as Record<string, unknown>
      return typeof candidate.workspaceRoot === "string" && typeof candidate.managedPath === "string"
    })
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }

    throw error
  }
}

const writeEntries = async (trackerFile: string, entries: WorkspaceTrackerEntry[]) => {
  await mkdir(dirname(trackerFile), { recursive: true })
  await writeFile(trackerFile, JSON.stringify(entries, null, 2) + "\n")
}

export const createWorkspaceTracker = (trackerFile: string): WorkspaceTracker => ({
  async list() {
    return readEntries(trackerFile)
  },
  async record(entry) {
    const entries = await readEntries(trackerFile)
    const next = [
      ...entries.filter((existing) => existing.workspaceRoot !== entry.workspaceRoot),
      entry,
    ]

    await writeEntries(trackerFile, next)
  },
  async remove(workspaceRoot) {
    const entries = await readEntries(trackerFile)
    await writeEntries(
      trackerFile,
      entries.filter((entry) => entry.workspaceRoot !== workspaceRoot),
    )
  },
  async clear() {
    await writeEntries(trackerFile, [])
  },
})
