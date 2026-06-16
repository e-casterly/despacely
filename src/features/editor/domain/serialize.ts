import type { SceneDocument } from './types'

/** Validates a raw value loaded from persistence into a scene document. */
export function parseDocument(raw: unknown): SceneDocument {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Scene document is not an object')
  }
  const doc = raw as Partial<SceneDocument>
  if (typeof doc.nodes !== 'object' || doc.nodes === null || Array.isArray(doc.nodes)) {
    throw new Error('Scene document is malformed')
  }
  if (!Array.isArray(doc.walls) || !Array.isArray(doc.items)) {
    throw new Error('Scene document is malformed')
  }
  return raw as SceneDocument
}
