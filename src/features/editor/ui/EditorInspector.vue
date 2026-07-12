<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import { MoveNodeCommand, SetWallPropsCommand } from '../domain/commands'
import { collapsesAWall, findNode, findWall, wallsAtNode, wallSegment } from '../domain/operations'
import { findRoom } from '../domain/rooms'
import { squareCmToM2 } from '../domain/units'
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

// view models of the current selection; useDocSnapshot re-reads them on every
// document change and keeps doc references out of the component
const wall = useDocSnapshot((doc) => {
  if (editor.selection?.kind !== 'wall') return null
  const found = findWall(doc, editor.selection.id)
  if (!found) return null
  const { a, b } = wallSegment(doc, found)
  return { ...found, length: Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 10) / 10 }
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

function commitWallProp(key: keyof typeof PROP_LIMITS, next: number) {
  if (wall.value) editor.apply(new SetWallPropsCommand(wall.value.id, { [key]: next }))
}

function commitNodeCoord(axis: 'x' | 'y', next: number) {
  if (!node.value || !editor.doc) return
  const from = { x: node.value.x, y: node.value.y }
  const to = { ...from, [axis]: next }
  // refuse a position that would collapse a wall; the field snaps back itself
  if (collapsesAWall(editor.doc, { [node.value.id]: to })) return
  editor.apply(new MoveNodeCommand(node.value.id, from, to))
}
</script>

<template>
  <aside
    v-if="wall || node || room"
    class="absolute right-3 top-3 flex w-64 flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-md"
  >
    <template v-if="wall">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-text-muted">Wall</h2>

      <dl class="flex flex-col gap-2 text-sm">
        <div class="flex items-center justify-between">
          <dt class="text-text-muted">Length</dt>
          <dd>{{ wall.length }} cm</dd>
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

    <BaseButton
      variant="danger"
      size="sm"
      class="w-full"
      :title="
        node
          ? 'Deletes the vertex and every wall meeting at it'
          : room
            ? 'Removes the room\'s walls; walls shared with a neighbouring room stay'
            : undefined
      "
      @click="editor.deleteSelection()"
    >
      {{ wall ? 'Delete wall' : node ? 'Delete vertex' : 'Delete room' }}
    </BaseButton>
  </aside>
</template>
