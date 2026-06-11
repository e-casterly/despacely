<script setup lang="ts">
const model = defineModel<string>({ required: true })

const { invalid = false } = defineProps<{
  invalid?: boolean
}>()
</script>

<template>
  <input
    v-model="model"
    :aria-invalid="invalid || undefined"
    class="h-9 w-full rounded-md border bg-surface px-3 text-sm text-text transition-colors placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
    :class="invalid ? 'border-danger' : 'border-border'"
  />
</template>
