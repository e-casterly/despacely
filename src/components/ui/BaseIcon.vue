<script setup lang="ts">
import type { Component } from 'vue'
import type { IconName } from './iconNames'

const modules = import.meta.glob('@/assets/icons/*.svg', {
  query: '?component',
  eager: true,
  import: 'default',
}) as Record<string, Component>

const icons = Object.fromEntries(
  Object.entries(modules).map(([path, component]) => [
    path.split('/').pop()!.replace('.svg', ''),
    component,
  ]),
)

const sizes = {
  sm: 16,
  md: 20,
  lg: 24,
} as const

const { name, size = 'md' } = defineProps<{
  name: IconName
  size?: keyof typeof sizes
}>()
</script>

<template>
  <component
    :is="icons[name]"
    :width="sizes[size]"
    :height="sizes[size]"
    aria-hidden="true"
  />
</template>
