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

  // transactional so the copy is all-or-nothing; when the editor's documents
  // table lands, add it to this transaction and copy the scene here as well
  duplicate(id: string, name: string): Promise<Project | undefined> {
    return db.transaction('rw', db.projects, async () => {
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
      return copy
    })
  },

  remove(id: string): Promise<void> {
    return db.projects.delete(id)
  },
}
