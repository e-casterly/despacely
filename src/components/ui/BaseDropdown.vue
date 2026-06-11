<script setup lang="ts">
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/vue'
import { onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'

defineOptions({ inheritAttrs: false })

const open = ref(false)
const root = useTemplateRef('root')
const panel = useTemplateRef('panel')

const { floatingStyles } = useFloating(root, panel, {
  placement: 'bottom-end',
  strategy: 'fixed',
  whileElementsMounted: autoUpdate,
  middleware: [offset(4), flip(), shift({ padding: 8 })],
})

function toggle() {
  open.value = !open.value
}

function close() {
  open.value = false
}

function onPointerDown(event: Event) {
  const target = event.target as Node
  if (root.value?.contains(target) || panel.value?.contains(target)) return
  close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

function removeListeners() {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKeydown)
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeydown)
  } else {
    removeListeners()
  }
})

onBeforeUnmount(removeListeners)
</script>

<template>
  <div ref="root" v-bind="$attrs" :data-open="open" class="inline-flex">
    <slot name="trigger" :toggle="toggle" :open="open" />
  </div>

  <Teleport to="body">
    <div v-if="open" ref="panel" class="z-50" :style="floatingStyles">
      <slot :close="close" />
    </div>
  </Teleport>
</template>
