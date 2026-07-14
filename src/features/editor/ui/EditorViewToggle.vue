<script setup lang="ts">
export type ViewMode = '2d' | '3d'

const { mode } = defineProps<{ mode: ViewMode }>()

const emit = defineEmits<{ change: [mode: ViewMode] }>()

const options: { value: ViewMode; label: string }[] = [
  { value: '2d', label: '2D' },
  { value: '3d', label: '3D' },
]
</script>

<template>
  <div
    class="absolute left-1/2 top-3 flex -translate-x-1/2 gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-md"
    role="group"
    aria-label="View mode"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="h-7 rounded-md px-3 text-xs font-medium tabular-nums transition-colors"
      :class="
        mode === option.value
          ? 'bg-primary text-white'
          : 'text-text-muted hover:bg-secondary hover:text-text'
      "
      :aria-pressed="mode === option.value"
      @click="emit('change', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
