// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { RunRecord } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import AsyncTerminalOutput from './AsyncTerminalOutput.vue'
import { useI18n } from './i18n'

const { loadTerminalOutputComponent } = vi.hoisted(() => ({
  loadTerminalOutputComponent: vi.fn(),
}))

vi.mock('./terminal-output-loader', () => ({ loadTerminalOutputComponent }))

const run: RunRecord = {
  id: 'run-1',
  projectId: 'project-1',
  capabilityId: 'command-1',
  command: 'pnpm',
  args: ['run', 'build'],
  cwd: '/workspace/project',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:01.000Z',
  exitCode: 0,
  stdout: 'build completed\n',
  stderr: '',
  status: 'completed',
}

const TerminalStub = defineComponent({
  props: { run: { type: Object, required: true } },
  template: '<pre data-testid="terminal-output">{{ run.stdout }}</pre>',
})

describe('async terminal output', () => {
  afterEach(() => {
    loadTerminalOutputComponent.mockReset()
  })

  it('renders command output after the terminal module loads', async () => {
    loadTerminalOutputComponent.mockResolvedValue(TerminalStub)

    const wrapper = mount(AsyncTerminalOutput, { props: { commandLabel: 'pnpm run build', run } })
    await flushPromises()

    expect(wrapper.get('[data-testid="terminal-output"]').text()).toContain('build completed')
  })

  it('shows a recoverable error instead of an empty panel when loading fails', async () => {
    useI18n().setLocale('en')
    loadTerminalOutputComponent
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce(TerminalStub)

    const wrapper = mount(AsyncTerminalOutput, { props: { commandLabel: 'pnpm run build', run } })
    await flushPromises()

    expect(wrapper.get('[data-testid="terminal-load-error"]').text()).toContain('Terminal output could not be loaded')
    expect(wrapper.get('[data-testid="terminal-load-error"]').text()).toContain('Failed to fetch dynamically imported module')

    await wrapper.get('[data-testid="retry-terminal-load"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="terminal-load-error"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="terminal-output"]').text()).toContain('build completed')
    expect(loadTerminalOutputComponent).toHaveBeenCalledTimes(2)
  })
})
