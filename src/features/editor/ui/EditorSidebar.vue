<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import type { ToolId } from '../tools/types'

const { activeTool } = defineProps<{
  activeTool: ToolId
  canUndo: boolean
  canRedo: boolean
}>()

const emit = defineEmits<{
  'select-tool': [tool: ToolId]
  undo: []
  redo: []
}>()

// clicking the active tool returns to the neutral 'select' mode
function toggleWall() {
  emit('select-tool', activeTool === 'wall' ? 'select' : 'wall')
}
</script>

<template>
  <aside class="flex w-44 flex-none flex-col gap-1 border-r border-border bg-surface p-2">
    <BaseButton
      :variant="activeTool === 'wall' ? 'primary' : 'ghost'"
      icon="wall"
      class="w-full justify-start"
      :aria-pressed="activeTool === 'wall'"
      @click="toggleWall"
    >
      Draw walls
    </BaseButton>

    <div class="mt-auto flex gap-1 border-t border-border pt-2">
      <BaseButton
        variant="ghost"
        size="sm"
        icon="undo"
        aria-label="Undo"
        :disabled="!canUndo"
        @click="$emit('undo')"
      />
      <BaseButton
        variant="ghost"
        size="sm"
        icon="redo"
        aria-label="Redo"
        :disabled="!canRedo"
        @click="$emit('redo')"
      />
    </div>
  </aside>
</template>
