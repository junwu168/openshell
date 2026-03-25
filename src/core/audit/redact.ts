export const redactSecrets = (value: string) =>
  value
    .replace(/:\/\/([^:\s]+):([^@\s]+)@/g, "://$1:[REDACTED]@")
    .replace(/(password|secret|token)=([^\s]+)/gi, "$1=[REDACTED]")
