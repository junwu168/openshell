export interface SecretProvider {
  getMasterKey(): Promise<Buffer>
}
