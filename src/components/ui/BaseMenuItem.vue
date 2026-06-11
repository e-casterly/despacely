<script setup lang="ts">
const { danger = false } = defineProps<{
  danger?: boolean
}>()
</script>

<template>
  <button
    type="button"
    role="menuitem"
    class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors"
    :class="danger ? 'text-danger hover:bg-danger-subtle' : 'text-text hover:bg-secondary'"
  >
    <slot />
  </button>
</template>
