import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import BaseDropdown from '../BaseDropdown.vue'

let wrapper: VueWrapper

function factory() {
  wrapper = mount(BaseDropdown, {
    attachTo: document.body,
    slots: {
      trigger: `<template #trigger="{ toggle }"><button data-test="trigger" @click="toggle">menu</button></template>`,
      default: '<button data-test="item">Item</button>',
    },
  })
  return wrapper
}

function panelContent() {
  return document.body.querySelector('[data-test="item"]')
}

afterEach(() => {
  wrapper.unmount()
})

describe('BaseDropdown', () => {
  it('is closed initially and opens into a portal on trigger click', async () => {
    factory()
    expect(panelContent()).toBeNull()

    await wrapper.get('[data-test="trigger"]').trigger('click')

    const content = panelContent()
    expect(content).not.toBeNull()
    // teleported to body, not rendered inside the component subtree
    expect(wrapper.element.contains(content)).toBe(false)
  })

  it('stays open on clicks inside the panel', async () => {
    factory()
    await wrapper.get('[data-test="trigger"]').trigger('click')

    const content = panelContent()
    content?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    content?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    expect(panelContent()).not.toBeNull()
  })

  it('closes on pointerdown outside', async () => {
    factory()
    await wrapper.get('[data-test="trigger"]').trigger('click')

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()

    expect(panelContent()).toBeNull()
  })

  it('closes on Escape', async () => {
    factory()
    await wrapper.get('[data-test="trigger"]').trigger('click')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(panelContent()).toBeNull()
  })

  it('removes the teleported panel when unmounted while open', async () => {
    factory()
    await wrapper.get('[data-test="trigger"]').trigger('click')

    wrapper.unmount()

    expect(panelContent()).toBeNull()
  })
})
