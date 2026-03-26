import { main } from "../src/cli/server-registry"

process.exitCode = await main(process.argv.slice(2))
