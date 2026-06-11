import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import BaseConfirmDialog from '../BaseConfirmDialog.vue'

let wrapper: VueWrapper

function factory() {
  wrapper = mount(BaseConfirmDialog, {
    attachTo: document.body,
    props: {
      open: true,
      title: 'Delete project?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
      'onUpdate:open': (value: boolean) => wrapper.setProps({ open: value }),
    },
  })
  return wrapper
}

function buttons() {
  const all = wrapper.findAll('button')
  return { cancel: all[0]!, confirm: all[1]! }
}

afterEach(() => {
  wrapper?.unmount()
})

describe('BaseConfirmDialog', () => {
  it('renders title, message and labels', () => {
    factory()
    expect(wrapper.text()).toContain('Delete project?')
    expect(wrapper.text()).toContain('This cannot be undone.')
    expect(buttons().confirm.text()).toBe('Delete')
    expect(buttons().cancel.text()).toBe('Cancel')
  })

  it('emits confirm and closes on confirm click', async () => {
    factory()
    await buttons().confirm.trigger('click')

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('emits cancel and closes on cancel click, without confirm', async () => {
    factory()
    await buttons().cancel.trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })
})
