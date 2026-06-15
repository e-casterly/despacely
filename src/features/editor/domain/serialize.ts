import type { SceneDocument } from './types'

/**
 * Validates a raw value loaded from persistence. The single entry point for
 * future format migrations: older versions get upgraded here before use.
 */
export function parseDocument(raw: unknown): SceneDocument {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Scene document is not an object')
  }
  const doc = raw as Partial<SceneDocument>
  if (doc.version !== 1) {
    throw new Error(`Unsupported scene document version: ${String(doc.version)}`)
  }
  if (!Array.isArray(doc.walls) || !Array.isArray(doc.items)) {
    throw new Error('Scene document is malformed')
  }
  return raw as SceneDocument
}
