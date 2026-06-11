<script setup lang="ts">
import { useTemplateRef, watchEffect } from 'vue'

const open = defineModel<boolean>('open', { required: true })

const dialog = useTemplateRef('dialog')

watchEffect(
  () => {
    const el = dialog.value
    if (!el) return
    if (open.value && !el.open) el.showModal()
    else if (!open.value && el.open) el.close()
  },
  { flush: 'post' },
)

// fires on Escape and any other native dismissal — keep the model in sync
function onClose() {
  open.value = false
}

// a backdrop click targets the <dialog> element itself; clicks on content
// target the inner wrapper, so this only closes on true outside clicks
function onClick(event: MouseEvent) {
  if (event.target === dialog.value) open.value = false
}
</script>

<template>
  <dialog
    ref="dialog"
    class="m-auto w-full max-w-sm rounded-lg border border-border bg-surface p-0 shadow-xl backdrop:bg-overlay"
    @close="onClose"
    @click="onClick"
  >
    <div class="p-6">
      <slot />
    </div>
  </dialog>
</template>
