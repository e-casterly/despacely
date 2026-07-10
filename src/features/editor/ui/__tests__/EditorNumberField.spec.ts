import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EditorNumberField from '../EditorNumberField.vue'

function mountField(value = 10) {
  return mount(EditorNumberField, {
    props: { value, min: 3, max: 150, label: 'Thickness, cm' },
  })
}

async function commit(wrapper: ReturnType<typeof mountField>, text: string) {
  const input = wrapper.get('input')
  await input.setValue(text)
  await input.trigger('change')
}

describe('EditorNumberField', () => {
  it('commits a rounded value on change', async () => {
    const wrapper = mountField()
    await commit(wrapper, '30.6')

    expect(wrapper.emitted('commit')).toEqual([[31]])
  })

  it('clamps out-of-range values', async () => {
    const wrapper = mountField()
    await commit(wrapper, '999')
    await commit(wrapper, '1')

    expect(wrapper.emitted('commit')).toEqual([[150], [3]])
  })

  it('emits nothing for the unchanged value', async () => {
    const wrapper = mountField()
    await commit(wrapper, '10')

    expect(wrapper.emitted('commit')).toBeUndefined()
  })

  it('treats an emptied field as invalid and snaps back, committing nothing', async () => {
    const wrapper = mountField()
    await commit(wrapper, '')

    expect(wrapper.emitted('commit')).toBeUndefined()
    expect(wrapper.get('input').element.value).toBe('10')
  })

  it('snaps back to the model when the parent rejects the commit', async () => {
    // parent not updating `value` after commit = rejection
    const wrapper = mountField()
    await commit(wrapper, '42')

    expect(wrapper.emitted('commit')).toEqual([[42]])
    expect(wrapper.get('input').element.value).toBe('10')
  })

  it('follows an accepted commit', async () => {
    const wrapper = mountField()
    await commit(wrapper, '42')
    await wrapper.setProps({ value: 42 }) // parent accepted

    expect(wrapper.get('input').element.value).toBe('42')
  })
})
