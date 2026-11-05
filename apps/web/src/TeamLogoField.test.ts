// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { useI18n } from './i18n'
import TeamLogoField from './TeamLogoField.vue'

it('previews a URL, uploads an embedded image and restores the default', async () => {
  useI18n().setLocale('en')
  const wrapper = mount(TeamLogoField)
  await wrapper.get('[data-testid="team-logo-url"]').setValue('https://example.com/logo.png')
  expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['https://example.com/logo.png'])
  const input = wrapper.get<HTMLInputElement>('input[type="file"]')
  const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'logo.svg', { type: 'image/svg+xml' })
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  await input.trigger('change')
  await vi.waitFor(() => expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toMatch(/^data:image\/svg\+xml;base64,/))
  await wrapper.setProps({ modelValue: wrapper.emitted('update:modelValue')!.at(-1)![0] as string })
  expect(wrapper.get('img').attributes('src')).toMatch(/^data:image\/svg\+xml;base64,/)
  expect(wrapper.get<HTMLInputElement>('[data-testid="team-logo-url"]').element.value).toBe('')
  await wrapper.get('[data-testid="reset-team-logo"]').trigger('click')
  expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([''])
  wrapper.unmount()
})

it('retains existing artwork when an uploaded file is unsupported or too large', async () => {
  const wrapper = mount(TeamLogoField, { props: { modelValue: 'https://example.com/logo.png' } })
  const input = wrapper.get<HTMLInputElement>('input[type="file"]')
  for (const file of [new File(['text'], 'logo.txt', { type: 'text/plain' }), new File([new Uint8Array(256 * 1024 + 1)], 'large.png', { type: 'image/png' })]) {
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('256 KB')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.get('img').attributes('src')).toBe('https://example.com/logo.png')
  }
  wrapper.unmount()
})
