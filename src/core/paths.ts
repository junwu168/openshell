import envPaths from "env-paths"
import { mkdir } from "node:fs/promises"

const paths = envPaths("open-code", { suffix: "" })

export const runtimePaths = {
  configDir: paths.config,
  dataDir: paths.data,
  registryFile: `${paths.config}/servers.enc.json`,
  auditLogFile: `${paths.data}/audit/actions.jsonl`,
  auditRepoDir: `${paths.data}/audit/repo`,
}

export const ensureRuntimeDirs = async () => {
  await mkdir(`${runtimePaths.dataDir}/audit`, { recursive: true })
  await mkdir(runtimePaths.configDir, { recursive: true })
}
