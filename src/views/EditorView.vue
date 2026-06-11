<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div class="p-8">
    <p class="text-text-muted">Editor — project {{ route.params.id }}</p>
  </div>
</template>
