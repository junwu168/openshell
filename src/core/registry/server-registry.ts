import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { dirname } from "node:path"
import { promisify } from "node:util"

export type ServerMetadataValue = string | number | boolean | null

export interface PasswordAuthRecord {
  kind: "password"
  secret: string
}

export interface PrivateKeyAuthRecord {
  kind: "privateKey"
  privateKeyPath: string
  passphrase?: string
}

export interface CertificateAuthRecord {
  kind: "certificate"
  certificatePath: string
  privateKeyPath: string
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

export type RegistryScope = "global" | "workspace"

export type ResolvedServerRecord = ServerRecord & {
  scope: RegistryScope
  shadowingGlobal?: boolean
  workspaceRoot?: string
}

export class RegistryRecordValidationError extends Error {
  readonly code = "REGISTRY_RECORD_INVALID" as const

  constructor(
    readonly file: string,
    readonly index: number,
    message: string,
  ) {
    super(`Invalid registry record in ${file} at index ${index}: ${message}`)
    this.name = "RegistryRecordValidationError"
  }
}

export interface ServerRegistry {
  list(): Promise<ResolvedServerRecord[]>
  resolve(id: string): Promise<ResolvedServerRecord | null>
  upsert(scope: RegistryScope, record: ServerRecord): Promise<void>
  remove(scope: RegistryScope, id: string): Promise<boolean>
  listRaw(scope: RegistryScope): Promise<ServerRecord[]>
}

type FileLockOptions = {
  getProcessStartTime?: (pid: number) => Promise<number | null>
  retryMs?: number
  timeoutMs?: number
}

export interface CreateServerRegistryOptions {
  globalRegistryFile: string
  workspaceRegistryFile: string
  workspaceRoot: string
  lockOptions?: FileLockOptions
}

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const validateString = (value: unknown, field: string, file: string, index: number) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RegistryRecordValidationError(file, index, `${field} must be a non-empty string`)
  }

  return value
}

const validateStringArray = (
  value: unknown,
  field: string,
  file: string,
  index: number,
): string[] | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new RegistryRecordValidationError(file, index, `${field} must be an array of non-empty strings`)
  }

  return value
}

const validateMetadata = (
  value: unknown,
  file: string,
  index: number,
): Record<string, ServerMetadataValue> | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (!isRecordObject(value)) {
    throw new RegistryRecordValidationError(file, index, "metadata must be an object")
  }

  for (const [key, entry] of Object.entries(value)) {
    if (typeof key !== "string" || key.trim() === "") {
      throw new RegistryRecordValidationError(file, index, "metadata keys must be non-empty strings")
    }

    if (
      !(
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean" ||
        entry === null
      )
    ) {
      throw new RegistryRecordValidationError(file, index, "metadata values must be strings, numbers, booleans, or null")
    }
  }

  return value as Record<string, ServerMetadataValue>
}

const validateAuth = (auth: unknown, file: string, index: number): ServerAuthRecord => {
  if (!isRecordObject(auth)) {
    throw new RegistryRecordValidationError(file, index, "auth must be an object")
  }

  const kind = validateString(auth.kind, "auth.kind", file, index)
  switch (kind) {
    case "password":
      return {
        kind,
        secret: validateString(auth.secret, "auth.secret", file, index),
      }
    case "privateKey":
      return {
        kind,
        privateKeyPath: validateString(auth.privateKeyPath, "auth.privateKeyPath", file, index),
        ...(typeof auth.passphrase === "string" ? { passphrase: auth.passphrase } : {}),
      }
    case "certificate":
      return {
        kind,
        certificatePath: validateString(auth.certificatePath, "auth.certificatePath", file, index),
        privateKeyPath: validateString(auth.privateKeyPath, "auth.privateKeyPath", file, index),
        ...(typeof auth.passphrase === "string" ? { passphrase: auth.passphrase } : {}),
      }
    default:
      throw new RegistryRecordValidationError(file, index, `unsupported auth kind: ${kind}`)
  }
}

const validateRecord = (record: unknown, file: string, index: number): ServerRecord => {
  if (!isRecordObject(record)) {
    throw new RegistryRecordValidationError(file, index, "record must be an object")
  }

  const labels = validateStringArray(record.labels, "labels", file, index)
  const groups = validateStringArray(record.groups, "groups", file, index)
  const metadata = validateMetadata(record.metadata, file, index)

  return {
    id: validateString(record.id, "id", file, index),
    host: validateString(record.host, "host", file, index),
    port: (() => {
      const port = record.port
      if (typeof port !== "number" || !Number.isInteger(port) || port <= 0) {
        throw new RegistryRecordValidationError(file, index, "port must be a positive integer")
      }
      return port
    })(),
    username: validateString(record.username, "username", file, index),
    ...(labels ? { labels } : {}),
    ...(groups ? { groups } : {}),
    ...(metadata ? { metadata } : {}),
    auth: validateAuth(record.auth, file, index),
  }
}

const parseRecords = (raw: string, file: string) => {
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid registry file: ${file}`)
  }

  return parsed.map((record, index) => validateRecord(record, file, index))
}

const buildResolvedRecord = (
  record: ServerRecord,
  scope: RegistryScope,
  workspaceRoot: string,
  shadowingGlobal = false,
): ResolvedServerRecord => ({
  ...record,
  scope,
  ...(scope === "workspace" ? { workspaceRoot } : {}),
  ...(shadowingGlobal ? { shadowingGlobal: true } : {}),
})

export const createServerRegistry = ({
  globalRegistryFile,
  workspaceRegistryFile,
  workspaceRoot,
  lockOptions,
}: CreateServerRegistryOptions): ServerRegistry => {
  const execFileAsync = promisify(execFile)
  const resolveProcessStartTime = lockOptions?.getProcessStartTime
  const lockRetryMs = lockOptions?.retryMs ?? 10
  const lockTimeoutMs = lockOptions?.timeoutMs ?? 5_000
  const fileQueues = new Map<string, Promise<void>>()

  const scopeFile = (scope: RegistryScope) =>
    scope === "global" ? globalRegistryFile : workspaceRegistryFile

  const getFileQueue = (file: string) => fileQueues.get(file) ?? Promise.resolve()

  const enqueueWrite = <T>(file: string, operation: () => Promise<T>) => {
    const next = getFileQueue(file).then(operation)
    fileQueues.set(
      file,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )

    return next
  }

  const waitForWrites = async (...files: string[]) => {
    await Promise.all(files.map((file) => getFileQueue(file)))
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

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

  const tryReclaimAbandonedLock = async (lockFile: string) => {
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

  const withFileLock = async <T>(file: string, operation: () => Promise<T>): Promise<T> => {
    const lockFile = `${file}.lock`
    const startedAt = Date.now()
    await mkdir(dirname(file), { recursive: true })

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

      if (await tryReclaimAbandonedLock(lockFile)) {
        continue
      }

      if (Date.now() - startedAt > lockTimeoutMs) {
        throw new Error(`Timed out waiting for registry lock: ${lockFile}`)
      }

      await sleep(lockRetryMs)
    }
  }

  const loadRaw = async (scope: RegistryScope): Promise<ServerRecord[]> => {
    const file = scopeFile(scope)

    try {
      const raw = await readFile(file, "utf8")
      return parseRecords(raw, file)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return []
      }

      throw error
    }
  }

  const saveRaw = async (scope: RegistryScope, records: ServerRecord[]) => {
    const file = scopeFile(scope)
    await mkdir(dirname(file), { recursive: true })
    const tempFile = `${file}.${process.pid}.${randomUUID()}.tmp`

    try {
      await writeFile(tempFile, JSON.stringify(records, null, 2))
      await rename(tempFile, file)
    } catch (error) {
      await rm(tempFile, { force: true })
      throw error
    }
  }

  const mergeRecords = (
    globalRecords: ServerRecord[],
    workspaceRecords: ServerRecord[],
  ): ResolvedServerRecord[] => {
    const merged = new Map<string, ResolvedServerRecord>()
    const order: string[] = []
    const globalIds = new Set<string>()

    for (const record of globalRecords) {
      globalIds.add(record.id)
      if (!merged.has(record.id)) {
        order.push(record.id)
      }
      merged.set(record.id, buildResolvedRecord(record, "global", workspaceRoot))
    }

    for (const record of workspaceRecords) {
      const shadowingGlobal = globalIds.has(record.id)
      if (!merged.has(record.id)) {
        order.push(record.id)
      }
      merged.set(record.id, buildResolvedRecord(record, "workspace", workspaceRoot, shadowingGlobal))
    }

    return order.map((id) => merged.get(id)!).filter(Boolean)
  }

  return {
    async list() {
      await waitForWrites(globalRegistryFile, workspaceRegistryFile)
      const [globalRecords, workspaceRecords] = await Promise.all([
        loadRaw("global"),
        loadRaw("workspace"),
      ])
      return mergeRecords(globalRecords, workspaceRecords)
    },
    async resolve(id) {
      await waitForWrites(globalRegistryFile, workspaceRegistryFile)
      const [globalRecords, workspaceRecords] = await Promise.all([
        loadRaw("global"),
        loadRaw("workspace"),
      ])
      return mergeRecords(globalRecords, workspaceRecords).find((record) => record.id === id) ?? null
    },
    async upsert(scope, record) {
      const file = scopeFile(scope)
      return enqueueWrite(file, async () =>
        withFileLock(file, async () => {
          const records = await loadRaw(scope)
          const next = records.filter((item) => item.id !== record.id)
          next.push(record)
          await saveRaw(scope, next)
        }),
      )
    },
    async remove(scope, id) {
      const file = scopeFile(scope)
      return enqueueWrite(file, async () =>
        withFileLock(file, async () => {
          const records = await loadRaw(scope)
          const next = records.filter((item) => item.id !== id)

          if (next.length === records.length) {
            return false
          }

          await saveRaw(scope, next)
          return true
        }),
      )
    },
    async listRaw(scope) {
      const file = scopeFile(scope)
      await waitForWrites(file)
      return loadRaw(scope)
    },
  }
}
