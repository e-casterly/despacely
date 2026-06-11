import Dexie, { type Table } from 'dexie'
import type { Project } from '@/features/projects/types'

class AppDB extends Dexie {
  projects!: Table<Project>

  constructor() {
    super('despacely')
    this.version(1).stores({
      projects: 'id, name, updatedAt',
    })
  }
}

export const db = new AppDB()

// Ask the browser to exempt this origin's storage from best-effort eviction
// (e.g. Safari's inactivity cleanup). Denial is fine — data just stays evictable.
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
