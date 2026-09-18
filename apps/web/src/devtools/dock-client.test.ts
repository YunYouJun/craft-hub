// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { DockEntryState, DocksEntriesContext } from '@vitejs/devtools-kit/client'
import { FRAME_NAV_CHANNEL, FRAME_NAV_VERSION } from '@vitejs/devtools-kit/client'
import { createEventEmitter } from 'devframe/utils/events'
import { expect, it, vi } from 'vitest'
import { inspectorFrameId, inspectorGroupId, inspectorTabs } from '../../devtools/navigation'
import setupInspectorDock from './dock-client'

it.each(['before', 'after'])('navigates a restored child when the frame mounts %s its client script', (timing) => {
  const states = new Map<string, DockEntryState>()
  for (const tab of inspectorTabs) {
    states.set(`${inspectorFrameId}:${tab.id}`, {
      entryMeta: { type: 'iframe', id: `${inspectorFrameId}:${tab.id}`, title: tab.title, icon: tab.icon, url: `/__craft-hub/#/${tab.id}`, frameId: inspectorFrameId, groupId: inspectorGroupId },
      isActive: false,
      domElements: {},
      events: createEventEmitter(),
    })
  }
  const docks = {
    getStateById: (id: string) => states.get(id),
    register: vi.fn(() => ({ update: vi.fn(), dispose: vi.fn() })),
    switchEntry: vi.fn(async () => true),
  } satisfies Pick<DocksEntriesContext, 'getStateById' | 'register' | 'switchEntry'>
  const iframe = document.createElement('iframe')
  document.body.append(iframe)
  const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {})
  const current = states.get('craft-hub:diagnostics')!
  // A restored child mounts first; the hidden anchor never receives this event.
  if (timing === 'before')
    current.domElements.iframe = iframe
  const dispose = setupInspectorDock({ current, docks })
  current.domElements.iframe = iframe
  current.events.emit('dom:iframe:mounted', iframe)
  expect(post).toHaveBeenCalledTimes(1)
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'hello' }), window.location.origin)
  window.dispatchEvent(new MessageEvent('message', {
    origin: window.location.origin,
    source: iframe.contentWindow,
    data: {
      channel: FRAME_NAV_CHANNEL,
      v: FRAME_NAV_VERSION,
      frameId: inspectorFrameId,
      from: 'frame',
      type: 'ready',
      current: 'diagnostics',
      tabs: inspectorTabs.map(tab => ({ ...tab, navTarget: { path: `/${tab.id}` } })),
    },
  }))
  states.get('craft-hub:runs')!.events.emit('entry:activated')
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'navigate', tabId: 'runs' }), window.location.origin)
  current.events.emit('entry:deactivated')
  current.events.emit('entry:activated')
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'navigate', tabId: 'diagnostics' }), window.location.origin)
  dispose()
  post.mockClear()
  states.get('craft-hub:runs')!.events.emit('entry:activated')
  expect(post).not.toHaveBeenCalled()
  iframe.remove()
})
