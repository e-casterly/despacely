import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import BaseDialog from '../BaseDialog.vue'

let wrapper: VueWrapper

function factory(open = false) {
  wrapper = mount(BaseDialog, {
    attachTo: document.body,
    props: {
      open,
      'onUpdate:open': (value: boolean) => wrapper.setProps({ open: value }),
    },
    slots: { default: '<p data-test="content">Hello</p>' },
  })
  return wrapper
}

function dialogEl() {
  return wrapper.get('dialog').element as HTMLDialogElement
}

afterEach(() => {
  wrapper?.unmount()
})

describe('BaseDialog', () => {
  it('opens and closes following the model', async () => {
    factory(false)
    expect(dialogEl().open).toBe(false)

    await wrapper.setProps({ open: true })
    expect(dialogEl().open).toBe(true)

    await wrapper.setProps({ open: false })
    expect(dialogEl().open).toBe(false)
  })

  it('opens immediately when mounted with open=true', async () => {
    factory(true)
    await nextTick()
    expect(dialogEl().open).toBe(true)
  })

  it('syncs the model when the dialog closes natively (Escape)', async () => {
    factory(false)
    await wrapper.setProps({ open: true })

    // jsdom has no real Escape handling on dialogs; close() fires the same
    // native `close` event that an Escape dismissal produces
    dialogEl().close()
    await nextTick()

    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('closes on backdrop click but not on content click', async () => {
    factory(false)
    await wrapper.setProps({ open: true })

    await wrapper.get('[data-test="content"]').trigger('click')
    expect(dialogEl().open).toBe(true)

    await wrapper.get('dialog').trigger('click')
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })
})
