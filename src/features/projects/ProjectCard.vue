<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseMenu from '@/components/ui/BaseMenu.vue'
import BaseMenuItem from '@/components/ui/BaseMenuItem.vue'

const { name, updatedAt } = defineProps<{
  name: string
  updatedAt: number
}>()

defineEmits<{
  click: []
  rename: []
  duplicate: []
  remove: []
}>()

const formattedDate = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}).format(updatedAt)
</script>

<template>
  <div
    class="group relative flex flex-col gap-3 p-5 bg-surface border border-border rounded-lg hover:shadow-md transition-shadow cursor-pointer"
    @click="$emit('click')"
  >
    <h2 class="font-semibold text-base leading-snug">{{ name }}</h2>
    <div class="mt-auto pt-2 text-xs text-text-muted">{{ formattedDate }}</div>

    <BaseMenu
      class="absolute bottom-3 right-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 data-[open=true]:opacity-100"
    >
      <template #trigger="{ toggle, open }">
        <BaseButton
          variant="ghost"
          size="sm"
          icon="menu"
          aria-label="Project menu"
          aria-haspopup="menu"
          :aria-expanded="open"
          class="text-text-muted"
          @click.stop="toggle"
        />
      </template>

      <BaseMenuItem @click="$emit('rename')">Rename</BaseMenuItem>
      <BaseMenuItem @click="$emit('duplicate')">Duplicate</BaseMenuItem>
      <BaseMenuItem danger @click="$emit('remove')">Delete</BaseMenuItem>
    </BaseMenu>
  </div>
</template>
