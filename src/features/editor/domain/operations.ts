import type { Item, SceneDocument, Vec2, Wall } from './types'

export function createEmptyDocument(): SceneDocument {
  return { version: 1, walls: [], items: [] }
}

export function addWall(doc: SceneDocument, wall: Wall): void {
  doc.walls.push(wall)
}

export function removeWall(doc: SceneDocument, id: string): void {
  doc.walls = doc.walls.filter((wall) => wall.id !== id)
}

export function findWall(doc: SceneDocument, id: string): Wall | undefined {
  return doc.walls.find((wall) => wall.id === id)
}

export function addItem(doc: SceneDocument, item: Item): void {
  doc.items.push(item)
}

export function removeItem(doc: SceneDocument, id: string): void {
  doc.items = doc.items.filter((item) => item.id !== id)
}

export function findItem(doc: SceneDocument, id: string): Item | undefined {
  return doc.items.find((item) => item.id === id)
}

export function moveItem(doc: SceneDocument, id: string, pos: Vec2): void {
  const item = findItem(doc, id)
  if (item) item.pos = pos
}
