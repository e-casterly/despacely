import type { SceneDocument, Wall } from './types'

/**
 * Validates a raw value loaded from persistence into a scene document, and
 * normalizes fields that older documents predate.
 *
 * Openings were added after documents were already being saved, so every wall
 * stored before then lacks the array. There is no version field to hang a
 * migration on, so defaulting it here *is* the migration — without it the first
 * `wall.openings.push(...)` would throw on any pre-existing project.
 */
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
  for (const wall of doc.walls as Wall[]) {
    if (!Array.isArray(wall.openings)) wall.openings = []
  }
  return raw as SceneDocument
}
