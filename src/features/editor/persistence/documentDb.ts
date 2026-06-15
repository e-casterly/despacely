import { db } from '@/db'
import { parseDocument } from '../domain/serialize'
import type { SceneDocument } from '../domain/types'

export interface StoredDocument {
  projectId: string
  doc: SceneDocument
  updatedAt: number
}

export const documentDb = {
  async get(projectId: string): Promise<SceneDocument | undefined> {
    const row = await db.documents.get(projectId)
    return row ? parseDocument(row.doc) : undefined
  },

  save(projectId: string, doc: SceneDocument): Promise<string> {
    return db.documents.put({ projectId, doc, updatedAt: Date.now() })
  },

  remove(projectId: string): Promise<void> {
    return db.documents.delete(projectId)
  },
}
