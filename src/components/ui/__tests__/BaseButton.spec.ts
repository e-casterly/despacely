import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseButton from '../BaseButton.vue'

describe('BaseButton', () => {
  it('renders the icon before the label', () => {
    const wrapper = mount(BaseButton, {
      props: { icon: 'plus' },
      slots: { default: 'New project' },
    })

    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.text()).toBe('New project')
    // labelled button keeps horizontal padding
    expect(wrapper.classes()).toContain('px-4')
  })

  it('becomes square in icon-only mode', () => {
    const wrapper = mount(BaseButton, { props: { icon: 'menu', size: 'sm' } })

    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.classes()).toContain('size-8')
    expect(wrapper.classes()).not.toContain('px-3')
  })

  it('scales the icon with the button size', () => {
    const small = mount(BaseButton, { props: { icon: 'plus', size: 'md' } })
    expect(small.get('svg').attributes('width')).toBe('16')

    const large = mount(BaseButton, { props: { icon: 'plus', size: 'lg' } })
    expect(large.get('svg').attributes('width')).toBe('20')
  })

  it('replaces the icon with the spinner while loading', () => {
    const wrapper = mount(BaseButton, {
      props: { icon: 'plus', loading: true },
      slots: { default: 'Saving' },
    })

    const svgs = wrapper.findAll('svg')
    expect(svgs).toHaveLength(1)
    expect(svgs[0]?.classes()).toContain('animate-spin')
    expect(wrapper.attributes('disabled')).toBeDefined()
  })
})
