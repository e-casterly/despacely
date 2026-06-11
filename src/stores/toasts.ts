import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
}

export const useToastStore = defineStore('toasts', () => {
  const toasts = ref<Toast[]>([])
  let nextId = 0

  function show(message: string, kind: Toast['kind'] = 'info', timeoutMs = 5000) {
    const id = ++nextId
    toasts.value.push({ id, message, kind })
    setTimeout(() => dismiss(id), timeoutMs)
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  return { toasts, show, dismiss }
})
