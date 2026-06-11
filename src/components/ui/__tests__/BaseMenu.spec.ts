import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import BaseMenu from '../BaseMenu.vue'
import BaseMenuItem from '../BaseMenuItem.vue'

let wrapper: VueWrapper

function factory() {
  wrapper = mount(BaseMenu, {
    attachTo: document.body,
    global: { components: { BaseMenuItem } },
    slots: {
      trigger: `<template #trigger="{ toggle }"><button data-test="trigger" @click="toggle">menu</button></template>`,
      default: '<BaseMenuItem data-test="item">Rename</BaseMenuItem>',
    },
  })
  return wrapper
}

function menuEl() {
  return document.body.querySelector('[role="menu"]')
}

afterEach(() => {
  wrapper.unmount()
})

describe('BaseMenu', () => {
  it('opens a menu panel with menu semantics on trigger click', async () => {
    factory()
    expect(menuEl()).toBeNull()

    await wrapper.get('[data-test="trigger"]').trigger('click')

    expect(menuEl()).not.toBeNull()
    expect(menuEl()?.querySelector('[role="menuitem"]')).not.toBeNull()
  })

  it('closes after a menu item is clicked', async () => {
    factory()
    await wrapper.get('[data-test="trigger"]').trigger('click')

    menuEl()?.querySelector<HTMLButtonElement>('[data-test="item"]')?.click()
    await nextTick()

    expect(menuEl()).toBeNull()
  })
})
