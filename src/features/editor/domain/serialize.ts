import type { SceneDocument, Wall } from './types'

/**
 * Validates a raw value loaded from persistence into a scene document, and
 * normalizes fields that older documents predate.
 *
 * Openings and dividers were both added after documents were already being
 * saved, so projects stored before then lack those arrays. There is no version
 * field to hang a migration on, so defaulting them here *is* the migration —
 * without it the first `wall.openings.push(...)` / `doc.dividers.push(...)` would
 * throw on any pre-existing project.
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
  if (!Array.isArray(doc.dividers)) doc.dividers = []
  return raw as SceneDocument
}
