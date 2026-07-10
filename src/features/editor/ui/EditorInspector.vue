<script setup lang="ts">
import { computed } from 'vue'
import { findWall, wallSegment } from '../domain/operations'
import { useEditorStore } from '../store/editorStore'

const editor = useEditorStore()

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
        <dd>{{ wall.thickness }} cm</dd>
      </div>
      <div class="flex items-center justify-between">
        <dt class="text-text-muted">Height</dt>
        <dd>{{ wall.height }} cm</dd>
      </div>
    </dl>
  </aside>
</template>
