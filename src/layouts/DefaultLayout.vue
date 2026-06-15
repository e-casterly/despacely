<script setup lang="ts">
import AppHeader from '@/components/app/AppHeader.vue'
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <AppHeader />
    <main class="container py-4">
      <slot />
    </main>
  </div>
</template>
