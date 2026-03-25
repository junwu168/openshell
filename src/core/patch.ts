import { applyPatch } from "diff"

export const applyUnifiedPatch = (source: string, patch: string) => {
  const next = applyPatch(source, patch)

  if (next === false) {
    throw new Error("patch apply failed")
  }

  return next
}
