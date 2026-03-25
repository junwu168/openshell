import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { decryptJson, encryptJson, type EncryptedJsonPayload } from "./crypto"
import type { SecretProvider } from "./secret-provider"

export type ServerMetadataValue = string | number | boolean | null

export interface PasswordAuthRecord {
  kind: "password"
  secret: string
}

export interface PrivateKeyAuthRecord {
  kind: "privateKey"
  privateKey: string
  passphrase?: string
}

export interface CertificateAuthRecord {
  kind: "certificate"
  certificate: string
  privateKey: string
  passphrase?: string
}

export type ServerAuthRecord =
  | PasswordAuthRecord
  | PrivateKeyAuthRecord
  | CertificateAuthRecord

export interface ServerRecord {
  id: string
  host: string
  port: number
  username: string
  labels?: string[]
  groups?: string[]
  metadata?: Record<string, ServerMetadataValue>
  auth: ServerAuthRecord
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
  let writeQueue = Promise.resolve()

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

  const enqueueWrite = <T>(operation: () => Promise<T>) => {
    const next = writeQueue.then(operation)
    writeQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  return {
    async list() {
      return load()
    },
    async resolve(id) {
      return (await load()).find((record) => record.id === id) ?? null
    },
    async upsert(record) {
      await enqueueWrite(async () => {
        const records = await load()
        const next = records.filter((item) => item.id !== record.id)
        next.push(record)
        await save(next)
      })
    },
  }
}
