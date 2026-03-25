import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
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
  const lockRetryMs = 10
  const lockStaleMs = 30_000
  const lockTimeoutMs = 5_000
  let writeQueue = Promise.resolve()
  const lockFile = `${registryFile}.lock`

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
    const tempFile = `${registryFile}.${process.pid}.${randomUUID()}.tmp`

    try {
      await writeFile(tempFile, JSON.stringify(payload, null, 2))
      await rename(tempFile, registryFile)
    } catch (error) {
      await rm(tempFile, { force: true })
      throw error
    }
  }

  const enqueueWrite = <T>(operation: () => Promise<T>) => {
    const next = writeQueue.then(operation)
    writeQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  const withRegistryWriteLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now()

    while (true) {
      try {
        const handle = await open(lockFile, "wx")
        try {
          return await operation()
        } finally {
          await handle.close()
          await rm(lockFile, { force: true })
        }
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error
        }
      }

      try {
        const lockStat = await stat(lockFile)
        if (Date.now() - lockStat.mtimeMs > lockStaleMs) {
          await rm(lockFile, { force: true })
          continue
        }
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error
        }
        continue
      }

      if (Date.now() - startedAt > lockTimeoutMs) {
        throw new Error(`Timed out waiting for registry lock: ${lockFile}`)
      }

      await sleep(lockRetryMs)
    }
  }

  const waitForOwnWrites = async () => {
    await writeQueue
  }

  return {
    async list() {
      await waitForOwnWrites()
      return load()
    },
    async resolve(id) {
      await waitForOwnWrites()
      return (await load()).find((record) => record.id === id) ?? null
    },
    async upsert(record) {
      await enqueueWrite(async () => {
        await withRegistryWriteLock(async () => {
          const records = await load()
          const next = records.filter((item) => item.id !== record.id)
          next.push(record)
          await save(next)
        })
      })
    },
  }
}
