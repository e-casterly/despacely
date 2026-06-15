import { db } from '@/db'
import type { Project } from './types'

export const projectDb = {
  getAll(): Promise<Project[]> {
    return db.projects.orderBy('updatedAt').reverse().toArray()
  },

  get(id: string): Promise<Project | undefined> {
    return db.projects.get(id)
  },

  save(project: Project): Promise<string> {
    return db.projects.put(project)
  },

  // transactional so the copy is all-or-nothing: a duplicated project can
  // never exist without its scene document, and vice versa
  duplicate(id: string, name: string): Promise<Project | undefined> {
    return db.transaction('rw', db.projects, db.documents, async () => {
      const source = await db.projects.get(id)
      if (!source) return undefined

      const copy: Project = {
        ...source,
        id: crypto.randomUUID(),
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      await db.projects.put(copy)

      const document = await db.documents.get(id)
      if (document) {
        await db.documents.put({ projectId: copy.id, doc: document.doc, updatedAt: Date.now() })
      }
      return copy
    })
  },

  remove(id: string): Promise<void> {
    return db.transaction('rw', db.projects, db.documents, async () => {
      await db.projects.delete(id)
      await db.documents.delete(id)
    })
  },
}
