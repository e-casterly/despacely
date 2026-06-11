<script setup lang="ts">
import BaseButton from './BaseButton.vue'
import BaseDialog from './BaseDialog.vue'

const open = defineModel<boolean>('open', { required: true })

const {
  title,
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
} = defineProps<{
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

function confirm() {
  emit('confirm')
  open.value = false
}

function cancel() {
  emit('cancel')
  open.value = false
}
</script>

<template>
  <BaseDialog v-model:open="open">
    <h2 class="text-base font-semibold">{{ title }}</h2>
    <p v-if="message" class="mt-2 text-sm text-text-muted">{{ message }}</p>

    <div class="mt-6 flex justify-end gap-2">
      <BaseButton variant="secondary" size="sm" @click="cancel">{{ cancelLabel }}</BaseButton>
      <BaseButton :variant="danger ? 'danger' : 'primary'" size="sm" @click="confirm">
        {{ confirmLabel }}
      </BaseButton>
    </div>
  </BaseDialog>
</template>
