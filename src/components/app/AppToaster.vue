<script setup lang="ts">
import { useToastStore } from '@/stores/toasts'

const store = useToastStore()
</script>

<template>
  <div class="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2" aria-live="polite">
    <button
      v-for="toast in store.toasts"
      :key="toast.id"
      type="button"
      class="max-w-sm rounded-md px-4 py-3 text-left text-sm text-white shadow-lg"
      :class="toast.kind === 'error' ? 'bg-danger' : 'bg-text'"
      @click="store.dismiss(toast.id)"
    >
      {{ toast.message }}
    </button>
  </div>
</template>
