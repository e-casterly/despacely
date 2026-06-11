import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'
import { useToastStore } from '@/stores/toasts'
import { projectDb } from './projectDb'
import type { Project } from './types'

export const useProjectStore = defineStore('projects', () => {
  const toasts = useToastStore()
  const projects = ref<Project[]>([])
  const loadFailed = ref(false)

  // All persistence failures funnel through here: the original error goes to the
  // console, the user gets a toast
  function reportError(action: string, error: unknown) {
    console.error(`Failed to ${action}`, error)
    const hint =
      error instanceof Error && error.name === 'QuotaExceededError'
        ? ' Browser storage is full.'
        : ''
    toasts.show(`Couldn't ${action}.${hint}`, 'error')
  }

  async function load() {
    try {
      projects.value = await projectDb.getAll()
      loadFailed.value = false
    } catch (error) {
      loadFailed.value = true
      reportError('load projects', error)
    }
  }

  async function create(name: string): Promise<Project | undefined> {
    const project: Project = {
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    try {
      await projectDb.save(project)
    } catch (error) {
      reportError('create the project', error)
      return undefined
    }
    projects.value.unshift(project)
    return project
  }

  async function rename(id: string, name: string) {
    const project = projects.value.find((p) => p.id === id)
    if (!project) return

    const previous = { name: project.name, updatedAt: project.updatedAt }
    project.name = name
    project.updatedAt = Date.now()
    try {
      await projectDb.save(toRaw(project))
    } catch (error) {
      Object.assign(project, previous)
      reportError('rename the project', error)
    }
  }

  async function remove(id: string) {
    try {
      await projectDb.remove(id)
    } catch (error) {
      reportError('delete the project', error)
      return
    }
    projects.value = projects.value.filter((p) => p.id !== id)
  }

  async function duplicate(id: string, name: string): Promise<Project | undefined> {
    const source = projects.value.find((p) => p.id === id)
    if (!source) return undefined

    try {
      const copy = await projectDb.duplicate(id, name)
      if (!copy) return undefined

      projects.value.unshift(copy)
      toasts.show(`Duplicated as “${copy.name}”.`)
      return copy
    } catch (error) {
      reportError('duplicate the project', error)
      return undefined
    }
  }

  async function updateThumbnail(id: string, thumbnail: string) {
    const project = projects.value.find((p) => p.id === id)
    if (!project) return

    const previous = { thumbnail: project.thumbnail, updatedAt: project.updatedAt }
    project.thumbnail = thumbnail
    project.updatedAt = Date.now()
    try {
      await projectDb.save(toRaw(project))
    } catch (error) {
      Object.assign(project, previous)
      reportError('save the project thumbnail', error)
    }
  }

  return { projects, loadFailed, load, create, rename, remove, duplicate, updateThumbnail }
})
