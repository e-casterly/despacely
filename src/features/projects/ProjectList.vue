<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseConfirmDialog from '@/components/ui/BaseConfirmDialog.vue'
import { nextCopyName } from './copyName'
import { useProjectStore } from './projectStore'
import ProjectCard from './ProjectCard.vue'
import ProjectNameDialog from './ProjectNameDialog.vue'
import type { Project } from './types'

const router = useRouter()
const store = useProjectStore()

onMounted(() => store.load())

async function handleCreate() {
  const count = store.projects.length + 1
  const project = await store.create(`Project ${count}`)
  if (project) router.push(`/projects/${project.id}`)
}

const projectToRename = ref<Project | null>(null)

const renameDialogOpen = computed({
  get: () => projectToRename.value !== null,
  set: (value) => {
    if (!value) projectToRename.value = null
  },
})

function handleRename(name: string) {
  const project = projectToRename.value
  if (project && name !== project.name) store.rename(project.id, name)
}

const projectToDuplicate = ref<Project | null>(null)

const duplicateDialogOpen = computed({
  get: () => projectToDuplicate.value !== null,
  set: (value) => {
    if (!value) projectToDuplicate.value = null
  },
})

const duplicateInitialName = computed(() =>
  projectToDuplicate.value
    ? nextCopyName(
        projectToDuplicate.value.name,
        store.projects.map((p) => p.name),
      )
    : '',
)

function handleDuplicate(name: string) {
  const project = projectToDuplicate.value
  if (project) store.duplicate(project.id, name)
}

const projectToRemove = ref<Project | null>(null)

const removeDialogOpen = computed({
  get: () => projectToRemove.value !== null,
  set: (value) => {
    if (!value) projectToRemove.value = null
  },
})

function confirmRemove() {
  const project = projectToRemove.value
  if (project) store.remove(project.id)
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-semibold">Projects</h1>
      <BaseButton icon="plus" @click="handleCreate">New project</BaseButton>
    </div>

    <div v-if="store.loadFailed" class="flex flex-col items-start gap-3 rounded-lg border border-border bg-bg-subtle p-6">
      <p class="text-sm text-text-muted">Couldn't load your projects.</p>
      <BaseButton variant="secondary" size="sm" @click="store.load()">Retry</BaseButton>
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      <ProjectCard
        v-for="project in store.projects"
        :key="project.id"
        :name="project.name"
        :updated-at="project.updatedAt"
        @click="router.push(`/projects/${project.id}`)"
        @rename="projectToRename = project"
        @duplicate="projectToDuplicate = project"
        @remove="projectToRemove = project"
      />
    </div>

    <ProjectNameDialog
      v-model:open="renameDialogOpen"
      title="Rename project"
      submit-label="Rename"
      :initial-name="projectToRename?.name ?? ''"
      @submit="handleRename"
    />

    <ProjectNameDialog
      v-model:open="duplicateDialogOpen"
      title="Duplicate project"
      submit-label="Duplicate"
      :initial-name="duplicateInitialName"
      @submit="handleDuplicate"
    />

    <BaseConfirmDialog
      v-model:open="removeDialogOpen"
      danger
      :title="`Delete “${projectToRemove?.name}”?`"
      message="The project and everything in it will be permanently deleted."
      confirm-label="Delete"
      @confirm="confirmRemove"
    />
  </div>
</template>
