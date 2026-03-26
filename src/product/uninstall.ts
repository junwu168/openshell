import { rm } from "node:fs/promises"
import { cwd, stdout } from "node:process"
import { createRuntimePaths } from "../core/paths.js"
import { uninstallFromOpenCodeConfig } from "./opencode-config.js"
import { createWorkspaceTracker } from "./workspace-tracker.js"

type WritableLike = {
  write(chunk: string): void
}

type RuntimePaths = ReturnType<typeof createRuntimePaths>

type UninstallOptions = {
  runtimePaths: RuntimePaths
  stdout: WritableLike
}

export const uninstallOpenShell = async ({ runtimePaths, stdout }: UninstallOptions) => {
  const tracker = createWorkspaceTracker(runtimePaths.workspaceTrackerFile)
  const trackedWorkspaces = await tracker.list()

  await uninstallFromOpenCodeConfig(runtimePaths.opencodeConfigFile)

  for (const entry of trackedWorkspaces) {
    await rm(entry.managedPath, { recursive: true, force: true })
  }

  await rm(runtimePaths.configDir, { recursive: true, force: true })
  await rm(runtimePaths.dataDir, { recursive: true, force: true })

  stdout.write(
    [
      "Removed openshell.",
      `OpenShell config: ${runtimePaths.configDir}`,
      `OpenShell data: ${runtimePaths.dataDir}`,
    ].join("\n") + "\n",
  )
}

export const runUninstallCli = async (_argv: string[] = [], stream: WritableLike = stdout) => {
  await uninstallOpenShell({
    runtimePaths: createRuntimePaths(cwd()),
    stdout: stream,
  })

  return 0
}
