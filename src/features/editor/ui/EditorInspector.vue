<script setup lang="ts">
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import {
  MoveNodeCommand,
  SetOpeningPropsCommand,
  SetWallPropsCommand,
  type OpeningProps,
} from '../domain/commands'
import {
  offsetRange,
  openingSpan,
  overlapsAnotherOpening,
  wallClearRange,
} from '../domain/openings'
import {
  collapsesAnEdge,
  findNode,
  findOpening,
  findWall,
  wallsAtNode,
  wallSegment,
} from '../domain/operations'
import { detectRooms, findRoom, wallFaceSides } from '../domain/rooms'
import { squareCmToM2 } from '../domain/units'
import { computeWallGeometry } from '../domain/wallJoints'
import { useEditorStore } from '../store/editorStore'
import { useDocSnapshot } from '../store/useDocSnapshot'
import EditorNumberField from './EditorNumberField.vue'

const editor = useEditorStore()

/**
 * UI clamps for the editable wall props (cm). Wide enough for the unusual —
 * thin glass partitions (3) to metre-thick historic masonry (150), low
 * room-divider knee walls (30) to industrial halls (1000) — while still
 * catching typos and nonsense.
 */
const PROP_LIMITS = {
  thickness: { min: 3, max: 150 },
  height: { min: 30, max: 1000 },
} as const


/** Coordinates carry no physical meaning, so the clamp only guards typos (±1 km). */
const COORD_LIMIT = { min: -100_000, max: 100_000 }

/**
 * UI clamps for an opening (cm). Width has no fixed ceiling here — the wall it is
 * cut into supplies one, since an opening can never be wider than the stretch of
 * wall left clear by the mitred corners.
 */
const OPENING_LIMITS = {
  width: { min: 30 },
  height: { min: 30, max: 400 },
  sill: { min: 0, max: 300 },
} as const

// view models of the current selection; useDocSnapshot re-reads them on every
// document change and keeps doc references out of the component
const wall = useDocSnapshot((doc) => {
  if (editor.selection?.kind !== 'wall') return null
  const found = findWall(doc, editor.selection.id)
  if (!found) return null
  const { a, b } = wallSegment(doc, found)
  const faces = computeWallGeometry(doc).faces.get(found.id)
  return {
    ...found,
    length: Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 10) / 10,
    sides: faces ? wallFaceSides(detectRooms(doc), faces) : null,
  }
})

/**
 * Read-only finished-face rows for the wall block. Hidden while both faces
 * match the axis (a free-standing wall carries no extra information). Labelled
 * Inner/Outer only when exactly one side borders a room; a partition between
 * two rooms (or a roomless corner) shows both faces in one row instead — the
 * plan already labels each face on its own side.
 */
const faceRows = computed(() => {
  const current = wall.value
  if (!current?.sides) return []
  const left = Math.round(current.sides.left.length * 10) / 10
  const right = Math.round(current.sides.right.length * 10) / 10
  if (left === current.length && right === current.length) return []
  if (current.sides.left.bordersRoom !== current.sides.right.bordersRoom) {
    const [inner, outer] = current.sides.left.bordersRoom ? [left, right] : [right, left]
    return [
      { label: 'Inner face', value: `${inner} cm`, hint: 'Finished length along the room side' },
      { label: 'Outer face', value: `${outer} cm`, hint: 'Finished length along the far side' },
    ]
  }
  return [
    {
      label: 'Faces',
      value: `${left} / ${right} cm`,
      hint: 'Finished face lengths, each labelled on its own side on the plan',
    },
  ]
})

const node = useDocSnapshot((doc) => {
  if (editor.selection?.kind !== 'node') return null
  const found = findNode(doc, editor.selection.id)
  if (!found) return null
  return {
    id: found.id,
    x: found.pos.x,
    y: found.pos.y,
    wallCount: wallsAtNode(doc, found.id).length,
  }
})

const room = useDocSnapshot((doc) => {
  if (editor.selection?.kind !== 'room') return null
  const found = findRoom(doc, editor.selection.id)
  if (!found) return null
  let perimeter = 0
  for (let i = 0; i < found.polygon.length; i++) {
    const a = found.polygon[i]!
    const b = found.polygon[(i + 1) % found.polygon.length]!
    perimeter += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return {
    // rooms are human-scale, so area reads in m² while lengths stay in cm
    area: squareCmToM2(found.area),
    perimeter: Math.round(perimeter * 10) / 10,
    corners: found.nodeIds.length,
  }
})

const opening = useDocSnapshot((doc) => {
  if (editor.selection?.kind !== 'opening') return null
  const found = findOpening(doc, editor.selection.id)
  if (!found) return null
  const faces = computeWallGeometry(doc).faces.get(found.wall.id)
  if (!faces) return null

  const { a, b } = wallSegment(doc, found.wall)
  const clear = wallClearRange(faces, a, b)
  const range = offsetRange(faces, a, b, found.opening.width)
  // The wall's own geometry supplies the bounds, so the number fields refuse an
  // edit that would push the opening through a corner before it is even applied.
  // Each bound is widened to admit the current value, so a field can always show
  // what is actually stored.
  return {
    id: found.opening.id,
    kind: found.opening.kind,
    offset: Math.round(found.opening.offset * 10) / 10,
    width: found.opening.width,
    height: found.opening.height,
    sill: found.opening.sill,
    wallLength: Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 10) / 10,
    maxWidth: Math.max(Math.floor(clear.to - clear.from), found.opening.width),
    offsetMin: range ? Math.min(Math.ceil(range.min), found.opening.offset) : found.opening.offset,
    offsetMax: range ? Math.max(Math.floor(range.max), found.opening.offset) : found.opening.offset,
  }
})

function commitWallProp(key: keyof typeof PROP_LIMITS, next: number) {
  if (wall.value) editor.apply(new SetWallPropsCommand(wall.value.id, { [key]: next }))
}

function commitOpeningProp(key: keyof OpeningProps, next: number) {
  if (!opening.value || !editor.doc) return
  const found = findOpening(editor.doc, opening.value.id)
  if (!found) return
  const faces = computeWallGeometry(editor.doc).faces.get(found.wall.id)
  if (!faces) return

  const candidate = { ...found.opening, [key]: next }
  // an edit that would break the opening out through a mitred corner, or run it
  // into its neighbour, is refused; EditorNumberField re-syncs to the prop after
  // every commit, so a refused value visibly snaps back
  if (!openingSpan(editor.doc, found.wall, candidate, faces)) return
  if (overlapsAnotherOpening(found.wall, candidate)) return

  editor.apply(new SetOpeningPropsCommand(opening.value.id, { [key]: next }))
}

const deleteLabel = computed(() => {
  if (wall.value) return 'Delete wall'
  if (node.value) return 'Delete vertex'
  if (opening.value) return opening.value.kind === 'door' ? 'Delete door' : 'Delete window'
  return 'Delete room'
})

const deleteHint = computed(() => {
  if (node.value) return 'Deletes the vertex and every wall meeting at it'
  if (room.value) return "Removes the room's walls; walls shared with a neighbouring room stay"
  return undefined
})

function commitNodeCoord(axis: 'x' | 'y', next: number) {
  if (!node.value || !editor.doc) return
  const from = { x: node.value.x, y: node.value.y }
  const to = { ...from, [axis]: next }
  // refuse a position that would collapse a wall; the field snaps back itself
  if (collapsesAnEdge(editor.doc, { [node.value.id]: to })) return
  editor.apply(new MoveNodeCommand(node.value.id, from, to))
}
</script>

<template>
  <aside
    v-if="wall || node || room || opening"
    class="absolute right-3 top-3 flex w-64 flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-md"
  >
    <template v-if="wall">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-text-muted">Wall</h2>

      <dl class="flex flex-col gap-2 text-sm">
        <div class="flex items-center justify-between">
          <dt class="text-text-muted" title="Axis length; edit lengths by clicking a dimension on the plan">
            Length
          </dt>
          <dd>{{ wall.length }} cm</dd>
        </div>
        <div v-for="row in faceRows" :key="row.label" class="flex items-center justify-between">
          <dt class="text-text-muted" :title="row.hint">{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-text-muted">Thickness</dt>
          <dd class="flex items-center gap-1.5">
            <EditorNumberField
              :value="wall.thickness"
              :min="PROP_LIMITS.thickness.min"
              :max="PROP_LIMITS.thickness.max"
              label="Thickness, cm"
              @commit="commitWallProp('thickness', $event)"
            />
            <span class="text-text-muted">cm</span>
          </dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-text-muted">Height</dt>
          <dd class="flex items-center gap-1.5">
            <EditorNumberField
              :value="wall.height"
              :min="PROP_LIMITS.height.min"
              :max="PROP_LIMITS.height.max"
              label="Height, cm"
              @commit="commitWallProp('height', $event)"
            />
            <span class="text-text-muted">cm</span>
          </dd>
        </div>
      </dl>
    </template>

    <template v-else-if="node">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-text-muted">Vertex</h2>

      <dl class="flex flex-col gap-2 text-sm">
        <div class="flex items-center justify-between">
          <dt class="text-text-muted">X</dt>
          <dd class="flex items-center gap-1.5">
            <EditorNumberField
              :value="node.x"
              :min="COORD_LIMIT.min"
              :max="COORD_LIMIT.max"
              label="X, cm"
              @commit="commitNodeCoord('x', $event)"
            />
            <span class="text-text-muted">cm</span>
          </dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-text-muted">Y</dt>
          <dd class="flex items-center gap-1.5">
            <EditorNumberField
              :value="node.y"
              :min="COORD_LIMIT.min"
              :max="COORD_LIMIT.max"
              label="Y, cm"
              @commit="commitNodeCoord('y', $event)"
            />
            <span class="text-text-muted">cm</span>
          </dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-text-muted">Walls</dt>
          <dd>{{ node.wallCount }}</dd>
        </div>
      </dl>
    </template>

    <template v-else-if="room">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-text-muted">Room</h2>

      <dl class="flex flex-col gap-2 text-sm">
        <div class="flex items-center justify-between">
          <dt class="text-text-muted">Area</dt>
          <dd>{{ room.area }} m²</dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-text-muted">Perimeter</dt>
          <dd>{{ room.perimeter }} cm</dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-text-muted">Corners</dt>
          <dd>{{ room.corners }}</dd>
        </div>
      </dl>
    </template>

    <template v-else-if="opening">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-text-muted">
        {{ opening.kind === 'door' ? 'Door' : 'Window' }}
      </h2>

      <dl class="flex flex-col gap-2 text-sm">
        <div class="flex items-center justify-between">
          <dt class="text-text-muted">Width</dt>
          <dd class="flex items-center gap-1.5">
            <EditorNumberField
              :value="opening.width"
              :min="OPENING_LIMITS.width.min"
              :max="opening.maxWidth"
              label="Width, cm"
              @commit="commitOpeningProp('width', $event)"
            />
            <span class="text-text-muted">cm</span>
          </dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-text-muted" title="Distance from the wall's start to the opening's middle">
            Offset
          </dt>
          <dd class="flex items-center gap-1.5">
            <EditorNumberField
              :value="opening.offset"
              :min="opening.offsetMin"
              :max="opening.offsetMax"
              label="Offset along the wall, cm"
              @commit="commitOpeningProp('offset', $event)"
            />
            <span class="text-text-muted">cm</span>
          </dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-text-muted">Height</dt>
          <dd class="flex items-center gap-1.5">
            <EditorNumberField
              :value="opening.height"
              :min="OPENING_LIMITS.height.min"
              :max="OPENING_LIMITS.height.max"
              label="Height, cm"
              @commit="commitOpeningProp('height', $event)"
            />
            <span class="text-text-muted">cm</span>
          </dd>
        </div>
        <div v-if="opening.kind === 'window'" class="flex items-center justify-between">
          <dt class="text-text-muted" title="Height of the sill above the floor">Sill</dt>
          <dd class="flex items-center gap-1.5">
            <EditorNumberField
              :value="opening.sill"
              :min="OPENING_LIMITS.sill.min"
              :max="OPENING_LIMITS.sill.max"
              label="Sill height, cm"
              @commit="commitOpeningProp('sill', $event)"
            />
            <span class="text-text-muted">cm</span>
          </dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-text-muted">Wall</dt>
          <dd>{{ opening.wallLength }} cm</dd>
        </div>
      </dl>
    </template>

    <BaseButton
      variant="danger"
      size="sm"
      class="w-full"
      :title="deleteHint"
      @click="editor.deleteSelection()"
    >
      {{ deleteLabel }}
    </BaseButton>
  </aside>
</template>
