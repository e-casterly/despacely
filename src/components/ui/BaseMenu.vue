<script setup lang="ts">
import BaseDropdown from './BaseDropdown.vue'
</script>

<template>
  <BaseDropdown>
    <template #trigger="props">
      <slot name="trigger" v-bind="props" />
    </template>

    <template #default="{ close }">
      <div
        role="menu"
        class="min-w-36 rounded-md border border-border bg-surface py-1 shadow-lg"
        @click="close()"
      >
        <slot />
      </div>
    </template>
  </BaseDropdown>
</template>
