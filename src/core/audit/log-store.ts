import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { redactSecrets } from "./redact"

export const createAuditLogStore = (file: string) => ({
  async preflight() {
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, "")
  },
  async append(entry: Record<string, unknown>) {
    const stamped = {
      timestamp: new Date().toISOString(),
      ...entry,
    }
    const json = JSON.stringify(stamped, (_key, value) =>
      typeof value === "string" ? redactSecrets(value) : value,
    )
    await appendFile(file, `${json}\n`)
  },
})
