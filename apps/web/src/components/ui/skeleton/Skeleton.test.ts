// @vitest-environment happy-dom
/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { Skeleton, SkeletonList } from './index'

describe('skeleton', () => {
  it('hides placeholder shapes from assistive technology', () => {
    const wrapper = mount(Skeleton, { props: { shape: 'block', width: '50%' } })
    expect(wrapper.attributes()).toMatchObject({ 'aria-hidden': 'true', 'data-slot': 'skeleton' })
    expect(wrapper.classes()).toContain('ui-skeleton--block')
    expect(wrapper.attributes('style')).toContain('width: 50%')
  })

  it('announces one busy status and mirrors the requested row layout', () => {
    const wrapper = mount(SkeletonList, { props: { label: 'Loading work', rows: 4, icon: true } })
    const status = wrapper.get('[role="status"]')
    expect(status.attributes('aria-busy')).toBe('true')
    expect(status.text()).toBe('Loading work')
    const rows = wrapper.findAll('.ui-skeleton-row')
    expect(rows).toHaveLength(4)
    expect(rows.every(row => row.attributes('aria-hidden') === 'true')).toBe(true)
    expect(rows[0]!.findAll('.ui-skeleton--circle')).toHaveLength(1)
    expect(rows[0]!.findAll('.ui-skeleton--line')).toHaveLength(2)
    expect(rows[0]!.findAll('.ui-skeleton--line')[0]!.attributes('style')).not.toBe(rows[1]!.findAll('.ui-skeleton--line')[0]!.attributes('style'))
  })

  it('omits the caption line for single-line rows', () => {
    const wrapper = mount(SkeletonList, { props: { label: 'Loading', rows: 2, meta: false } })
    expect(wrapper.findAll('.ui-skeleton--line')).toHaveLength(2)
    expect(wrapper.find('.ui-skeleton--circle').exists()).toBe(false)
  })
})
