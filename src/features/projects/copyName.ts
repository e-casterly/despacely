const COPY_SUFFIX = /^(?<base>.*) \(copy(?: \d+)?\)$/

// "My flat" -> "My flat (copy)" -> "My flat (copy 2)" -> ..., always picking
// the first name not already taken; copies of copies share the same base name.
export function nextCopyName(sourceName: string, takenNames: Iterable<string>): string {
  const base = COPY_SUFFIX.exec(sourceName)?.groups?.base ?? sourceName
  const taken = new Set(takenNames)

  let candidate = `${base} (copy)`
  for (let n = 2; taken.has(candidate); n++) {
    candidate = `${base} (copy ${n})`
  }
  return candidate
}
