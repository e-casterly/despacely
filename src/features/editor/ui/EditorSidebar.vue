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
function toggle(tool: Exclude<ToolId, 'select'>) {
  emit('select-tool', activeTool === tool ? 'select' : tool)
}
</script>

<template>
  <aside class="flex w-44 flex-none flex-col gap-1 border-r border-border bg-surface p-2">
    <BaseButton
      :variant="activeTool === 'wall' ? 'primary' : 'ghost'"
      icon="wall"
      class="w-full justify-start"
      :aria-pressed="activeTool === 'wall'"
      @click="toggle('wall')"
    >
      Draw walls
    </BaseButton>

    <BaseButton
      :variant="activeTool === 'room' ? 'primary' : 'ghost'"
      icon="room"
      class="w-full justify-start"
      :aria-pressed="activeTool === 'room'"
      @click="toggle('room')"
    >
      Draw room
    </BaseButton>

    <BaseButton
      :variant="activeTool === 'door' ? 'primary' : 'ghost'"
      icon="door"
      class="w-full justify-start"
      :aria-pressed="activeTool === 'door'"
      @click="toggle('door')"
    >
      Door
    </BaseButton>

    <BaseButton
      :variant="activeTool === 'window' ? 'primary' : 'ghost'"
      icon="window"
      class="w-full justify-start"
      :aria-pressed="activeTool === 'window'"
      @click="toggle('window')"
    >
      Window
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
