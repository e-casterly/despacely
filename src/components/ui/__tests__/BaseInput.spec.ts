import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseInput from '../BaseInput.vue'

describe('BaseInput', () => {
  it('binds the model both ways', async () => {
    const wrapper = mount(BaseInput, {
      props: {
        modelValue: 'initial',
        'onUpdate:modelValue': (value: string) => wrapper.setProps({ modelValue: value }),
      },
    })
    const input = wrapper.get('input')
    expect(input.element.value).toBe('initial')

    await input.setValue('changed')
    expect(wrapper.props('modelValue')).toBe('changed')
  })

  it('marks the field invalid for assistive tech', () => {
    const wrapper = mount(BaseInput, { props: { modelValue: '', invalid: true } })
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true')
  })

  it('passes native attributes through to the input', () => {
    const wrapper = mount(BaseInput, {
      props: { modelValue: '' },
      attrs: { placeholder: 'Name', type: 'search' },
    })
    expect(wrapper.get('input').attributes('placeholder')).toBe('Name')
    expect(wrapper.get('input').attributes('type')).toBe('search')
  })
})
