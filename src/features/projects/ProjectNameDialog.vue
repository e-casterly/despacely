<script setup lang="ts">
import { ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseInput from '@/components/ui/BaseInput.vue'

const open = defineModel<boolean>('open', { required: true })

const {
  title,
  initialName,
  submitLabel = 'Save',
} = defineProps<{
  title: string
  initialName: string
  submitLabel?: string
}>()

const emit = defineEmits<{
  submit: [name: string]
}>()

const name = ref('')

watch(
  open,
  (isOpen) => {
    if (isOpen) name.value = initialName
  },
  { immediate: true },
)

function submit() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  emit('submit', trimmed)
  open.value = false
}
</script>

<template>
  <BaseDialog v-model:open="open">
    <h2 class="text-base font-semibold">{{ title }}</h2>

    <form class="mt-4 flex flex-col gap-4" @submit.prevent="submit">
      <BaseInput v-model="name" :invalid="!name.trim()" aria-label="Project name" autofocus />

      <div class="flex justify-end gap-2">
        <BaseButton variant="secondary" size="sm" type="button" @click="open = false">
          Cancel
        </BaseButton>
        <BaseButton size="sm" type="submit" :disabled="!name.trim()">{{ submitLabel }}</BaseButton>
      </div>
    </form>
  </BaseDialog>
</template>
