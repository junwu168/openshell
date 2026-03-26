import envPaths from "env-paths"
import { mkdir } from "node:fs/promises"
import { cwd } from "node:process"

export const createRuntimePaths = (workspaceRoot: string) => {
  const openshellPaths = envPaths("openshell", { suffix: "" })
  const opencodePaths = envPaths("opencode", { suffix: "" })

  return {
    configDir: openshellPaths.config,
    dataDir: openshellPaths.data,
    globalRegistryFile: `${openshellPaths.config}/servers.json`,
    workspaceTrackerFile: `${openshellPaths.data}/workspaces.json`,
    opencodeConfigDir: opencodePaths.config,
    opencodeConfigFile: `${opencodePaths.config}/opencode.json`,
    workspaceRegistryDir: `${workspaceRoot}/.open-code`,
    workspaceRegistryFile: `${workspaceRoot}/.open-code/servers.json`,
    auditLogFile: `${openshellPaths.data}/audit/actions.jsonl`,
    auditRepoDir: `${openshellPaths.data}/audit/repo`,
  }
}

export const runtimePaths = createRuntimePaths(cwd())

export const workspaceRegistryFile = (workspaceRoot: string) =>
  `${workspaceRoot}/.open-code/servers.json`

export const ensureRuntimeDirs = async () => {
  await mkdir(`${runtimePaths.dataDir}/audit`, { recursive: true })
  await mkdir(runtimePaths.auditRepoDir, { recursive: true })
  await mkdir(runtimePaths.configDir, { recursive: true })
}
