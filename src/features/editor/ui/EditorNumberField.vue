<script setup lang="ts">
import { nextTick } from 'vue'

/**
 * Compact numeric field with commit-on-change semantics (blur commits; Enter
 * blurs first, so both paths fire `change` exactly once). Typing stays local
 * to the input; `commit` fires with a rounded, clamped value only when it
 * differs from the current one. After the parent reacts, the input re-syncs
 * with the model, so invalid input and rejected commits visibly snap back.
 */
const { value, min, max } = defineProps<{
  value: number
  min: number
  max: number
  label: string
}>()

const emit = defineEmits<{ commit: [value: number] }>()

async function onChange(event: Event) {
  const input = event.target as HTMLInputElement
  const raw = input.value.trim()
  // Number('') === 0, so an emptied field must be treated as invalid, not as 0
  const parsed = raw === '' ? NaN : Math.round(Number(raw))
  const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value
  if (next !== value) emit('commit', next)
  await nextTick()
  input.value = String(value) // whatever the model actually accepted
}

function blurOnEnter(event: KeyboardEvent) {
  ;(event.target as HTMLInputElement).blur()
}
</script>

<template>
  <input
    type="number"
    class="h-7 w-20 rounded-md border border-border bg-surface px-2 text-right text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
    :value="value"
    :min="min"
    :max="max"
    :aria-label="label"
    @change="onChange"
    @keydown.enter="blurOnEnter"
  />
</template>
