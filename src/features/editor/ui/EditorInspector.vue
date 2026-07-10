<script setup lang="ts">
import { computed } from 'vue'
import { SetWallPropsCommand } from '../domain/commands'
import { findWall, wallSegment } from '../domain/operations'
import { useEditorStore } from '../store/editorStore'

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

/**
 * Commits an edited value on `change` (fires on blur; Enter blurs first), so
 * typing stays local to the input and history gets one entry per edit.
 * Invalid input falls back to the current value; out-of-range input is clamped.
 */
function commitProp(key: keyof typeof PROP_LIMITS, event: Event) {
  const input = event.target as HTMLInputElement
  if (!wall.value) return
  const current = wall.value[key]
  const { min, max } = PROP_LIMITS[key]
  const raw = input.value.trim()
  // Number('') === 0, so an emptied field must be treated as invalid, not as 0
  const parsed = raw === '' ? NaN : Math.round(Number(raw))
  const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : current
  // normalize what the user sees (NaN, clamped or decimal input)
  input.value = String(next)
  if (next !== current) editor.apply(new SetWallPropsCommand(wall.value.id, { [key]: next }))
}

function blurOnEnter(event: KeyboardEvent) {
  ;(event.target as HTMLInputElement).blur()
}

// The document is non-reactive; reading `revision` re-runs this on every change.
// Return a fresh snapshot, not the doc's own object: a same-reference result
// would not notify dependents (computeds/template) even though its fields changed.
const wall = computed(() => {
  void editor.revision
  if (!editor.doc || editor.selection?.kind !== 'wall') return null
  const found = findWall(editor.doc, editor.selection.id)
  return found ? { ...found } : null
})

const length = computed(() => {
  if (!editor.doc || !wall.value) return 0
  const { a, b } = wallSegment(editor.doc, wall.value)
  return Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 10) / 10
})
</script>

<template>
  <aside
    v-if="wall"
    class="absolute right-3 top-3 flex w-64 flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-md"
  >
    <h2 class="text-xs font-semibold uppercase tracking-wide text-text-muted">Wall</h2>

    <dl class="flex flex-col gap-2 text-sm">
      <div class="flex items-center justify-between">
        <dt class="text-text-muted">Length</dt>
        <dd>{{ length }} cm</dd>
      </div>
      <div class="flex items-center justify-between">
        <dt class="text-text-muted">Thickness</dt>
        <dd class="flex items-center gap-1.5">
          <input
            type="number"
            class="h-7 w-20 rounded-md border border-border bg-surface px-2 text-right text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            :value="wall.thickness"
            :min="PROP_LIMITS.thickness.min"
            :max="PROP_LIMITS.thickness.max"
            aria-label="Thickness, cm"
            @change="commitProp('thickness', $event)"
            @keydown.enter="blurOnEnter"
          />
          <span class="text-text-muted">cm</span>
        </dd>
      </div>
      <div class="flex items-center justify-between">
        <dt class="text-text-muted">Height</dt>
        <dd class="flex items-center gap-1.5">
          <input
            type="number"
            class="h-7 w-20 rounded-md border border-border bg-surface px-2 text-right text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            :value="wall.height"
            :min="PROP_LIMITS.height.min"
            :max="PROP_LIMITS.height.max"
            aria-label="Height, cm"
            @change="commitProp('height', $event)"
            @keydown.enter="blurOnEnter"
          />
          <span class="text-text-muted">cm</span>
        </dd>
      </div>
    </dl>
  </aside>
</template>
