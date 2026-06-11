<script setup lang="ts">
import { computed, useSlots } from 'vue'
import BaseIcon from './BaseIcon.vue'
import type { IconName } from './iconNames'

const {
  variant = 'primary',
  size = 'md',
  icon,
  disabled = false,
  loading = false,
  type = 'button',
} = defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: IconName
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit' | 'reset'
}>()

const slots = useSlots()

// icon without label content -> square button instead of horizontal padding
const iconOnly = computed(() => Boolean(icon) && !slots.default)

const iconSize = computed(() => (size === 'lg' ? 'md' : 'sm'))
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :class="[
      'inline-flex items-center justify-center gap-1 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50',
      {
        sm: iconOnly ? 'size-8 rounded-sm' : 'h-8 px-3 text-sm rounded-sm',
        md: iconOnly ? 'size-9 rounded-md' : 'h-9 px-4 text-sm rounded-md',
        lg: iconOnly ? 'size-11 rounded-lg' : 'h-11 px-6 text-base rounded-lg',
      }[size],
      {
        primary: 'bg-primary text-white hover:bg-primary-hover',
        secondary: 'bg-secondary text-text hover:bg-border',
        ghost: 'text-text hover:bg-secondary',
        danger: 'bg-danger text-white hover:bg-danger-hover',
      }[variant],
    ]"
  >
    <svg
      v-if="loading"
      class="size-4 animate-spin"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
    <BaseIcon v-else-if="icon" :name="icon" :size="iconSize" />
    <slot />
  </button>
</template>
