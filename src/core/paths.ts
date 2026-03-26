import envPaths from "env-paths"
import { mkdir } from "node:fs/promises"

export const createRuntimePaths = (_workspaceRoot?: string) => {
  const paths = envPaths("open-code", { suffix: "" })

  return {
    configDir: paths.config,
    dataDir: paths.data,
    globalRegistryFile: `${paths.config}/servers.json`,
    auditLogFile: `${paths.data}/audit/actions.jsonl`,
    auditRepoDir: `${paths.data}/audit/repo`,
  }
}

export const runtimePaths = createRuntimePaths()

export const workspaceRegistryFile = (workspaceRoot: string) =>
  `${workspaceRoot}/.open-code/servers.json`

export const ensureRuntimeDirs = async () => {
  await mkdir(`${runtimePaths.dataDir}/audit`, { recursive: true })
  await mkdir(runtimePaths.auditRepoDir, { recursive: true })
  await mkdir(runtimePaths.configDir, { recursive: true })
}
