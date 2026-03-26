import { main } from "../src/cli/openshell"

process.exitCode = await main(process.argv.slice(2))
