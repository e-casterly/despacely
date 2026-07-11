<script setup lang="ts">
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const { zoom } = defineProps<{ zoom: number }>()

defineEmits<{
  'zoom-in': []
  'zoom-out': []
  fit: []
}>()

const percent = computed(() => `${Math.round(zoom * 100)}%`)
</script>

<template>
  <div
    class="absolute bottom-3 right-3 flex gap-1 rounded-lg border border-border bg-surface p-1 shadow-md"
  >
    <BaseButton
      variant="ghost"
      size="sm"
      icon="focus"
      aria-label="Zoom to fit"
      title="Zoom to fit"
      @click="$emit('fit')"
    />
    <BaseButton
      variant="ghost"
      size="sm"
      icon="minus"
      aria-label="Zoom out"
      title="Zoom out"
      @click="$emit('zoom-out')"
    />
    <span
      class="w-12 self-center text-center text-sm tabular-nums text-text-muted"
      title="Zoom level"
    >
      {{ percent }}
    </span>
    <BaseButton
      variant="ghost"
      size="sm"
      icon="plus"
      aria-label="Zoom in"
      title="Zoom in"
      @click="$emit('zoom-in')"
    />
  </div>
</template>
