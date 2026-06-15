<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import type { ToolId } from '../tools/types'

const { activeTool } = defineProps<{ activeTool: ToolId }>()

const emit = defineEmits<{ 'select-tool': [tool: ToolId] }>()

// clicking the active tool returns to select
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
  </aside>
</template>
