<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppHeader from "@/components/app/AppHeader.vue";
import AppToaster from "@/components/app/AppToaster.vue";
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <AppHeader />
    <RouterView />
    <AppToaster />
  </div>
</template>
