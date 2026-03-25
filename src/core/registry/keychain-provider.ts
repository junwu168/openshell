import { randomBytes } from "node:crypto"
import keytar from "keytar"
import type { SecretProvider } from "./secret-provider"

const SERVICE = "open-code"
const ACCOUNT = "registry-master-key"

export const createKeychainSecretProvider = (): SecretProvider => ({
  async getMasterKey() {
    let secret = await keytar.getPassword(SERVICE, ACCOUNT)
    if (!secret) {
      secret = randomBytes(32).toString("base64")
      await keytar.setPassword(SERVICE, ACCOUNT, secret)
    }
    return Buffer.from(secret, "base64")
  },
})
