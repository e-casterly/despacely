import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ProjectNameDialog from '../ProjectNameDialog.vue'

let wrapper: VueWrapper

function factory(initialName = 'My flat') {
  wrapper = mount(ProjectNameDialog, {
    attachTo: document.body,
    props: {
      open: true,
      title: 'Rename project',
      submitLabel: 'Rename',
      initialName,
      'onUpdate:open': (value: boolean) => wrapper.setProps({ open: value }),
    },
  })
  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
})

describe('ProjectNameDialog', () => {
  it('renders the title and prefills the input', () => {
    factory()
    expect(wrapper.text()).toContain('Rename project')
    expect(wrapper.get('input').element.value).toBe('My flat')
    expect(wrapper.get('button[type="submit"]').text()).toBe('Rename')
  })

  it('emits the trimmed name and closes on submit', async () => {
    factory()
    await wrapper.get('input').setValue('  New name  ')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toEqual([['New name']])
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('emits the unchanged name too — deciding is the caller’s job', async () => {
    factory()
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toEqual([['My flat']])
  })

  it('does not submit an empty name', async () => {
    factory()
    await wrapper.get('input').setValue('   ')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('closes without emitting on cancel', async () => {
    factory()
    await wrapper.get('input').setValue('New name')
    await wrapper.get('button[type="button"]').trigger('click')

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('re-prefills from initialName on each open', async () => {
    factory()
    await wrapper.get('input').setValue('Garbage')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ initialName: 'Other', open: true })

    expect(wrapper.get('input').element.value).toBe('Other')
  })
})
