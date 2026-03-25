import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { decryptJson, encryptJson, type EncryptedJsonPayload } from "./crypto"
import type { SecretProvider } from "./secret-provider"

export interface PasswordAuthRecord {
  kind: "password"
  secret: string
}

export interface ServerRecord {
  id: string
  host: string
  port: number
  username: string
  auth: PasswordAuthRecord
}

export interface ServerRegistry {
  list(): Promise<ServerRecord[]>
  resolve(id: string): Promise<ServerRecord | null>
  upsert(record: ServerRecord): Promise<void>
}

export interface CreateServerRegistryOptions {
  registryFile: string
  secretProvider: SecretProvider
}

export const createServerRegistry = ({
  registryFile,
  secretProvider,
}: CreateServerRegistryOptions): ServerRegistry => {
  const load = async (): Promise<ServerRecord[]> => {
    try {
      const raw = await readFile(registryFile, "utf8")
      const payload = JSON.parse(raw) as EncryptedJsonPayload
      const key = await secretProvider.getMasterKey()
      return JSON.parse(decryptJson(payload, key)) as ServerRecord[]
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return []
      }

      throw error
    }
  }

  const save = async (records: ServerRecord[]) => {
    await mkdir(dirname(registryFile), { recursive: true })
    const key = await secretProvider.getMasterKey()
    const payload = encryptJson(JSON.stringify(records), key)
    await writeFile(registryFile, JSON.stringify(payload, null, 2))
  }

  return {
    async list() {
      return load()
    },
    async resolve(id) {
      return (await load()).find((record) => record.id === id) ?? null
    },
    async upsert(record) {
      const records = await load()
      const next = records.filter((item) => item.id !== record.id)
      next.push(record)
      await save(next)
    },
  }
}
