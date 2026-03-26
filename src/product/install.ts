import { mkdir } from "node:fs/promises"
import { cwd, stdout } from "node:process"
import { createRuntimePaths } from "../core/paths.js"
import { installIntoOpenCodeConfig } from "./opencode-config.js"
import { createWorkspaceTracker } from "./workspace-tracker.js"

type WritableLike = {
  write(chunk: string): void
}

type RuntimePaths = ReturnType<typeof createRuntimePaths>

type InstallOptions = {
  runtimePaths: RuntimePaths
  stdout: WritableLike
}

export const installOpenShell = async ({ runtimePaths, stdout }: InstallOptions) => {
  await mkdir(runtimePaths.configDir, { recursive: true })
  await mkdir(runtimePaths.dataDir, { recursive: true })
  await mkdir(runtimePaths.opencodeConfigDir, { recursive: true })

  await installIntoOpenCodeConfig(runtimePaths.opencodeConfigFile)
  await createWorkspaceTracker(runtimePaths.workspaceTrackerFile).clear()

  stdout.write(
    [
      "Installed openshell.",
      `OpenShell config: ${runtimePaths.configDir}`,
      `OpenShell data: ${runtimePaths.dataDir}`,
      `OpenCode config: ${runtimePaths.opencodeConfigFile}`,
    ].join("\n") + "\n",
  )
}

export const runInstallCli = async (_argv: string[] = [], stream: WritableLike = stdout) => {
  await installOpenShell({
    runtimePaths: createRuntimePaths(cwd()),
    stdout: stream,
  })

  return 0
}
