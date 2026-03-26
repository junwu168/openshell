import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export const defaultBashPermissions = {
  "*": "ask",
  "cat *": "allow",
  "grep *": "allow",
  "find *": "allow",
  "ls *": "allow",
  pwd: "allow",
  "uname *": "allow",
  "df *": "allow",
  "free *": "allow",
  "ps *": "allow",
  "systemctl status *": "allow",
} as const

type OpenCodeConfig = {
  plugin?: string[]
  permission?: {
    edit?: unknown
    bash?: unknown
    [key: string]: unknown
  }
  [key: string]: unknown
}

const readConfig = async (opencodeConfigFile: string): Promise<OpenCodeConfig> => {
  try {
    return JSON.parse(await readFile(opencodeConfigFile, "utf8")) as OpenCodeConfig
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {}
    }

    throw error
  }
}

const writeConfig = async (opencodeConfigFile: string, config: OpenCodeConfig) => {
  await mkdir(dirname(opencodeConfigFile), { recursive: true })
  await writeFile(opencodeConfigFile, JSON.stringify(config, null, 2) + "\n")
}

export const installIntoOpenCodeConfig = async (opencodeConfigFile: string) => {
  const current = await readConfig(opencodeConfigFile)
  const plugins = Array.isArray(current.plugin) ? [...current.plugin] : []
  if (!plugins.includes("@junwu168/openshell")) {
    plugins.push("@junwu168/openshell")
  }

  const currentPermissions =
    typeof current.permission === "object" && current.permission !== null ? current.permission : {}
  const currentBash =
    typeof currentPermissions.bash === "object" && currentPermissions.bash !== null
      ? currentPermissions.bash
      : {}

  await writeConfig(opencodeConfigFile, {
    ...current,
    plugin: plugins,
    permission: {
      ...currentPermissions,
      edit: currentPermissions.edit ?? "ask",
      bash: {
        ...defaultBashPermissions,
        ...currentBash,
      },
    },
  })
}

export const uninstallFromOpenCodeConfig = async (opencodeConfigFile: string) => {
  const current = await readConfig(opencodeConfigFile)
  const plugins = Array.isArray(current.plugin)
    ? current.plugin.filter((plugin) => plugin !== "@junwu168/openshell")
    : []
  const currentPermissions =
    typeof current.permission === "object" && current.permission !== null ? { ...current.permission } : {}
  const currentBash =
    typeof currentPermissions.bash === "object" && currentPermissions.bash !== null
      ? { ...(currentPermissions.bash as Record<string, unknown>) }
      : null

  if (currentBash) {
    for (const [pattern, permission] of Object.entries(defaultBashPermissions)) {
      if (currentBash[pattern] === permission) {
        delete currentBash[pattern]
      }
    }

    if (Object.keys(currentBash).length === 0) {
      delete currentPermissions.bash
    } else {
      currentPermissions.bash = currentBash
    }
  }

  if (currentPermissions.edit === "ask") {
    delete currentPermissions.edit
  }

  const nextConfig: OpenCodeConfig = { ...current }

  if (plugins.length > 0) {
    nextConfig.plugin = plugins
  } else {
    delete nextConfig.plugin
  }

  if (Object.keys(currentPermissions).length > 0) {
    nextConfig.permission = currentPermissions
  } else {
    delete nextConfig.permission
  }

  await writeConfig(opencodeConfigFile, nextConfig)
}
