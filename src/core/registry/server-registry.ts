import { link, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { dirname } from "node:path"
import { promisify } from "node:util"
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
  remove(id: string): Promise<boolean>
}

export interface CreateServerRegistryOptions {
  registryFile: string
  secretProvider: SecretProvider
  lockOptions?: {
    getProcessStartTime?: (pid: number) => Promise<number | null>
    retryMs?: number
    timeoutMs?: number
  }
}

export const createServerRegistry = ({
  registryFile,
  secretProvider,
  lockOptions,
}: CreateServerRegistryOptions): ServerRegistry => {
  const execFileAsync = promisify(execFile)
  const resolveProcessStartTime = lockOptions?.getProcessStartTime
  const lockRetryMs = lockOptions?.retryMs ?? 10
  const lockTimeoutMs = lockOptions?.timeoutMs ?? 5_000
  let writeQueue = Promise.resolve()
  const lockFile = `${registryFile}.lock`

  const isProcessAlive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ESRCH") {
        return false
      }
      if (code === "EPERM") {
        return true
      }
      throw error
    }
  }

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

  const getProcessStartTime = async (pid: number) => {
    if (resolveProcessStartTime) {
      return resolveProcessStartTime(pid)
    }

    try {
      const { stdout } = await execFileAsync("ps", ["-o", "etimes=", "-p", String(pid)])
      const elapsedSecondsText = stdout.trim()
      if (!/^\d+$/.test(elapsedSecondsText)) {
        return null
      }

      const elapsedSeconds = Number.parseInt(elapsedSecondsText, 10)
      if (!Number.isFinite(elapsedSeconds)) {
        return null
      }

      return Date.now() - elapsedSeconds * 1_000
    } catch (error: unknown) {
      const exitCode = (error as { code?: unknown }).code
      if (exitCode === 1 || exitCode === "EPERM") {
        return null
      }
      throw error
    }
  }

  const tryReclaimAbandonedLock = async () => {
    let raw: string
    try {
      raw = await readFile(lockFile, "utf8")
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false
      }
      throw error
    }

    let ownerPid: number | null = null
    let lockCreatedAt: number | null = null
    try {
      const parsed = JSON.parse(raw) as { pid?: unknown; createdAt?: unknown }
      ownerPid = typeof parsed.pid === "number" ? parsed.pid : null
      if (typeof parsed.createdAt === "string") {
        const parsedCreatedAt = Date.parse(parsed.createdAt)
        lockCreatedAt = Number.isNaN(parsedCreatedAt) ? null : parsedCreatedAt
      }
    } catch {
      return false
    }

    if (ownerPid === null) {
      return false
    }

    if (isProcessAlive(ownerPid)) {
      if (lockCreatedAt === null) {
        return false
      }

      const ownerStartedAt = await getProcessStartTime(ownerPid)
      if (ownerStartedAt === null || ownerStartedAt <= lockCreatedAt) {
        return false
      }
    }

    const reclaimedLockFile = `${lockFile}.reclaimed.${randomUUID()}`
    try {
      await rename(lockFile, reclaimedLockFile)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false
      }
      throw error
    }

    await rm(reclaimedLockFile, { force: true })
    return true
  }

  const withRegistryWriteLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now()
    await mkdir(dirname(registryFile), { recursive: true })

    while (true) {
      const pendingLockFile = `${lockFile}.${process.pid}.${randomUUID()}.pending`
      try {
        await writeFile(
          pendingLockFile,
          JSON.stringify({
            pid: process.pid,
            createdAt: new Date().toISOString(),
          }),
        )

        await link(pendingLockFile, lockFile)

        try {
          return await operation()
        } finally {
          await rm(lockFile, { force: true })
        }
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error
        }
      } finally {
        await rm(pendingLockFile, { force: true })
      }

      if (await tryReclaimAbandonedLock()) {
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
    async remove(id) {
      return enqueueWrite(async () =>
        withRegistryWriteLock(async () => {
          const records = await load()
          const next = records.filter((item) => item.id !== id)

          if (next.length === records.length) {
            return false
          }

          await save(next)
          return true
        }),
      )
    },
  }
}
