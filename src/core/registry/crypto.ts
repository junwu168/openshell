import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

export interface EncryptedJsonPayload {
  iv: string
  tag: string
  body: string
}

export const encryptJson = (plaintext: string, key: Buffer): EncryptedJsonPayload => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    body: body.toString("base64"),
  }
}

export const decryptJson = (payload: EncryptedJsonPayload, key: Buffer) => {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"))
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"))

  return Buffer.concat([
    decipher.update(Buffer.from(payload.body, "base64")),
    decipher.final(),
  ]).toString("utf8")
}
