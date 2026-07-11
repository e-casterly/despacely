import type { Command } from '../domain/commands'
import type { NodeId, SceneDocument, Vec2 } from '../domain/types'

/** The editor's active interaction mode. 'select' is the neutral mode. */
export type ToolId = 'select' | 'wall'

/** A pointer event delivered to a tool in world coordinates (cm). */
export interface PointerInput {
  world: Vec2
  shift: boolean
}

/** What is currently selected in the editor (extends to items later). */
export type Selection = { kind: 'wall'; id: string } | { kind: 'node'; id: NodeId }

/** Everything a tool needs to read the scene and commit edits. */
export interface ToolContext {
  doc: SceneDocument
  apply: (command: Command) => void
  select: (selection: Selection | null) => void
  /** pointer pick/snap tolerance in world cm, derived from zoom */
  snapDist: number
}

/** Transient visuals a tool draws over the scene (e.g. the wall being placed). */
export interface ToolOverlay {
  ghostWall?: { a: Vec2; b: Vec2 }
  /** Drag preview: render these nodes (and walls on them) at overridden positions. */
  movedNodes?: Record<NodeId, Vec2>
  /** Ring on the vertex the dragged vertex will weld into when dropped. */
  mergeTarget?: NodeId
}

/**
 * An interaction mode. Tools own their in-progress (preview) state, separate
 * from the document, and commit changes through ctx.apply as commands.
 */
export interface Tool {
  readonly id: ToolId
  readonly preview: ToolOverlay | null
  onPointerDown?(input: PointerInput, ctx: ToolContext): void
  onPointerMove?(input: PointerInput, ctx: ToolContext): void
  onPointerUp?(input: PointerInput, ctx: ToolContext): void
  /** cancels any in-progress interaction (Esc, switching tools) */
  cancel?(): void
}
