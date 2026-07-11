<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import BaseButton from '@/components/ui/BaseButton.vue'
import Canvas2D from '@/features/editor/render2d/Canvas2D.vue'
import EditorInspector from '@/features/editor/ui/EditorInspector.vue'
import EditorSidebar from '@/features/editor/ui/EditorSidebar.vue'
import EditorZoomControls from '@/features/editor/ui/EditorZoomControls.vue'
import { useEditorStore } from '@/features/editor/store/editorStore'
import type { ToolId } from '@/features/editor/tools/types'
import { useProjectStore } from '@/features/projects/projectStore'

const route = useRoute()
const editor = useEditorStore()
const projects = useProjectStore()

const activeTool = ref<ToolId>('select')
const canvas = useTemplateRef<InstanceType<typeof Canvas2D>>('canvas')

const projectId = computed(() => route.params.id as string)
const project = computed(() => projects.projects.find((p) => p.id === projectId.value))
const projectMissing = computed(() => projects.projects.length > 0 && !project.value)

const saveLabel = computed(
  () => ({ saved: 'Saved', saving: 'Saving…', error: 'Save failed' })[editor.saveState],
)

function onPageHide() {
  void editor.flush()
}

function onKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

  if (event.key === 'Escape') {
    activeTool.value = 'select'
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    editor.deleteSelection()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) editor.redo()
    else editor.undo()
  }
}

onMounted(async () => {
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('keydown', onKeyDown)
  if (projects.projects.length === 0) await projects.load()
  await editor.open(projectId.value)
})

// vue-router reuses this component when navigating editor -> editor
watch(projectId, async (id, previous) => {
  if (id && id !== previous) {
    await editor.close()
    await editor.open(id)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('pagehide', onPageHide)
  window.removeEventListener('keydown', onKeyDown)
  void editor.close()
})
</script>

<template>
  <div class="flex flex-col h-svh">
    <div class="flex flex-none items-center gap-4 border-b border-border bg-surface px-4 py-2">
      <RouterLink to="/" class="text-sm text-text-muted hover:text-text">← Projects</RouterLink>
      <h1 class="text-sm font-semibold">{{ project?.name ?? '…' }}</h1>
      <span
        class="ml-auto text-xs"
        :class="editor.saveState === 'error' ? 'text-danger' : 'text-text-muted'"
      >
        {{ saveLabel }}
      </span>
    </div>

    <div v-if="projectMissing" class="flex flex-1 flex-col items-center justify-center gap-3">
      <p class="text-sm text-text-muted">Project not found.</p>
      <RouterLink to="/"><BaseButton variant="secondary" size="sm">Back to projects</BaseButton></RouterLink>
    </div>

    <div v-else-if="editor.loadFailed" class="flex flex-1 flex-col items-center justify-center gap-3">
      <p class="text-sm text-text-muted">Couldn't open the scene.</p>
      <BaseButton variant="secondary" size="sm" @click="editor.open(projectId)">Retry</BaseButton>
    </div>

    <div v-else class="relative flex flex-1 overflow-hidden">
      <EditorSidebar
        :active-tool="activeTool"
        :can-undo="editor.canUndo"
        :can-redo="editor.canRedo"
        @select-tool="activeTool = $event"
        @undo="editor.undo"
        @redo="editor.redo"
      />
      <Canvas2D v-if="editor.doc" ref="canvas" :active-tool="activeTool" />
      <EditorInspector />
      <EditorZoomControls
        v-if="editor.doc"
        :zoom="canvas?.zoomLevel ?? 1"
        @zoom-in="canvas?.zoomIn()"
        @zoom-out="canvas?.zoomOut()"
        @fit="canvas?.zoomToFit()"
      />
    </div>
  </div>
</template>
