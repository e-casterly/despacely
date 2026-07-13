import type { Command } from '../domain/commands'
import type { Guide } from '../domain/snapping'
import type { NodeId, SceneDocument, Vec2 } from '../domain/types'

/** The editor's active interaction mode. 'select' is the neutral mode. */
export type ToolId = 'select' | 'wall' | 'room'

/** A pointer event delivered to a tool in world coordinates (cm). */
export interface PointerInput {
  world: Vec2
  shift: boolean
}

/** What is currently selected in the editor (extends to items later).
 * A room is derived, not stored, so its id is the roomKey of its contour. */
export type Selection =
  | { kind: 'wall'; id: string }
  | { kind: 'node'; id: NodeId }
  | { kind: 'room'; id: string }

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
  /** In-progress room: the ordered corners of the closed loop being drawn. */
  ghostRoom?: Vec2[]
  /** A room still too small to place: shown as a light outline, not the full ghost. */
  roomDraft?: Vec2[]
  /** Drag preview: render these nodes (and walls on them) at overridden positions. */
  movedNodes?: Record<NodeId, Vec2>
  /** Ring on the vertex the dragged vertex will weld into when dropped. */
  mergeTarget?: NodeId
  /** Snap guides the current point is aligned to, drawn as construction lines. */
  guides?: Guide[]
}

/**
 * An interaction mode. Tools own their in-progress (preview) state, separate
 * from the document, and commit changes through ctx.apply as commands.
 */
export interface Tool {
  readonly id: ToolId
  readonly preview: ToolOverlay | null
  /**
   * The tool's live text entry (e.g. a wall length being typed), or null when it
   * isn't capturing keys. While non-null the tool owns digit/Backspace/Enter/Esc,
   * so the rest of the app must leave those keys alone.
   */
  readonly textEntry?: { value: string } | null
  onPointerDown?(input: PointerInput, ctx: ToolContext): void
  onPointerMove?(input: PointerInput, ctx: ToolContext): void
  onPointerUp?(input: PointerInput, ctx: ToolContext): void
  /** Feeds a key to the tool; returns true when the tool consumed it. */
  onKey?(key: string, ctx: ToolContext): boolean
  /** cancels any in-progress interaction (Esc, switching tools) */
  cancel?(): void
}
