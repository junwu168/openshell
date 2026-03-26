import { stderr, stdout } from "node:process"
import { runInstallCli } from "../product/install.js"
import { runUninstallCli } from "../product/uninstall.js"
import { runServerRegistryCli } from "./server-registry.js"

type WritableLike = {
  write(chunk: string): void
}

type OpenShellCliDeps = {
  stdout: WritableLike
  stderr: WritableLike
  runServerRegistryCli: (argv: string[]) => Promise<number>
  runInstallCli: (argv: string[]) => Promise<number>
  runUninstallCli: (argv: string[]) => Promise<number>
}

const usage = [
  "Usage: openshell <install|uninstall|server-registry>",
  "",
  "Commands:",
  "  install           configure OpenCode for the openshell plugin",
  "  uninstall         remove OpenCode integration and local openshell state",
  "  server-registry   manage configured remote servers",
].join("\n")

const createDefaultDeps = (): OpenShellCliDeps => ({
  stdout: { write: (chunk) => stdout.write(chunk) },
  stderr: { write: (chunk) => stderr.write(chunk) },
  runServerRegistryCli,
  runInstallCli,
  runUninstallCli,
})

export const runOpenShellCli = async (argv: string[], deps?: Partial<OpenShellCliDeps>) => {
  const activeDeps = {
    ...createDefaultDeps(),
    ...deps,
  }

  const [command, ...rest] = argv

  switch (command) {
    case undefined:
      activeDeps.stdout.write(`${usage}\n`)
      return 0
    case "server-registry":
      return activeDeps.runServerRegistryCli(rest)
    case "install":
      return activeDeps.runInstallCli(rest)
    case "uninstall":
      return activeDeps.runUninstallCli(rest)
    default:
      activeDeps.stderr.write(`${usage}\n`)
      return 1
  }
}

export const main = async (argv: string[] = process.argv.slice(2)) => runOpenShellCli(argv)
