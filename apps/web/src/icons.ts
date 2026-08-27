import type { VNode } from 'vue'
import { h } from 'vue'

export type IconName = 'arrowDown' | 'arrowRight' | 'check' | 'close' | 'codex' | 'collection' | 'drag' | 'edit' | 'error' | 'folder' | 'hub' | 'palette' | 'plugins' | 'plus' | 'search' | 'settings' | 'source' | 'star' | 'starFilled' | 'stop' | 'terminal' | 'terminalApp' | 'skill' | 'play' | 'trusted' | 'untrusted' | 'refresh' | 'vscode' | 'workspace'

const iconClasses: Record<Exclude<IconName, 'codex' | 'plugins' | 'vscode'>, string> = {
  arrowDown: 'i-ri-arrow-down-s-line',
  arrowRight: 'i-ri-arrow-right-s-line',
  check: 'i-ri-checkbox-circle-fill',
  close: 'i-ri-close-line',
  collection: 'i-ri-stack-line',
  drag: 'i-ri-draggable',
  edit: 'i-ri-edit-line',
  error: 'i-ri-error-warning-fill',
  folder: 'i-ri-folder-3-line',
  hub: 'i-ri-node-tree',
  palette: 'i-ri-palette-line',
  plus: 'i-ri-add-line',
  search: 'i-ri-search-line',
  settings: 'i-ri-settings-3-line',
  source: 'i-ri-file-search-line',
  star: 'i-ri-star-line',
  starFilled: 'i-ri-star-fill',
  stop: 'i-ri-stop-fill',
  terminal: 'i-ri-terminal-box-line',
  terminalApp: 'i-ri-terminal-window-line',
  skill: 'i-ri-sparkling-2-line',
  play: 'i-ri-play-fill',
  trusted: 'i-ri-shield-check-line',
  untrusted: 'i-ri-shield-keyhole-line',
  refresh: 'i-ri-loader-4-line',
  workspace: 'i-ri-layout-grid-line',
}

export function Icon(props: { name: IconName }): VNode {
  if (props.name === 'plugins') {
    return h('svg', {
      'aria-hidden': 'true',
      'class': ['app-icon', 'plugins-icon'],
      'fill': 'none',
      'stroke': 'currentColor',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-width': '1.7',
      'viewBox': '0 0 24 24',
    }, [
      h('rect', { x: '3.5', y: '3.5', width: '6.5', height: '6.5', rx: '1.4' }),
      h('rect', { x: '14', y: '3.5', width: '6.5', height: '6.5', rx: '1.4' }),
      h('rect', { x: '3.5', y: '14', width: '6.5', height: '6.5', rx: '1.4' }),
      h('path', { d: 'M14 17.25h6.5M17.25 14v6.5' }),
    ])
  }

  if (props.name === 'vscode') {
    return h('svg', {
      'aria-hidden': 'true',
      'class': ['app-icon', 'vscode-icon'],
      'fill': 'currentColor',
      'viewBox': '0 0 24 24',
    }, [h('path', { d: 'M23.15 2.587 18.21.21a1.49 1.49 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a1 1 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a1 1 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.49 1.49 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352m-5.146 14.861L10.826 12l7.178-5.448z' })])
  }

  if (props.name === 'codex') {
    return h('svg', {
      'aria-hidden': 'true',
      'class': ['app-icon', 'codex-icon'],
      'fill': 'currentColor',
      'viewBox': '0 0 24 24',
    }, [h('path', { d: 'M20.562 10.188c.25-.688.313-1.376.25-2.063-.062-.687-.312-1.375-.625-2-.562-.937-1.375-1.687-2.312-2.125-1-.437-2.063-.562-3.125-.312-.5-.5-1.063-.938-1.688-1.25S11.687 2 11 2a5.17 5.17 0 0 0-3 .938c-.875.624-1.5 1.5-1.813 2.5-.75.187-1.375.5-2 .875-.562.437-1 1-1.375 1.562-.562.938-.75 2-.625 3.063a5.44 5.44 0 0 0 1.25 2.874 4.7 4.7 0 0 0-.25 2.063c.063.688.313 1.375.625 2 .563.938 1.375 1.688 2.313 2.125 1 .438 2.062.563 3.125.313.5.5 1.062.937 1.687 1.25S12.312 22 13 22a5.17 5.17 0 0 0 3-.937c.875-.625 1.5-1.5 1.812-2.5a4.54 4.54 0 0 0 1.938-.875c.562-.438 1.062-.938 1.375-1.563.562-.937.75-2 .625-3.062-.125-1.063-.5-2.063-1.188-2.876m-7.5 10.5c-1 0-1.75-.313-2.437-.875 0 0 .062-.063.125-.063l4-2.312a.5.5 0 0 0 .25-.25.57.57 0 0 0 .062-.313V11.25l1.688 1v4.625a3.685 3.685 0 0 1-3.688 3.813M5 17.25c-.438-.75-.625-1.625-.438-2.5 0 0 .063.063.125.063l4 2.312a.56.56 0 0 0 .313.063c.125 0 .25 0 .312-.063l4.875-2.812v1.937l-4.062 2.375A3.7 3.7 0 0 1 7.312 19c-1-.25-1.812-.875-2.312-1.75M3.937 8.563a3.8 3.8 0 0 1 1.938-1.626v4.751c0 .124 0 .25.062.312a.5.5 0 0 0 .25.25l4.875 2.813-1.687 1-4-2.313a3.7 3.7 0 0 1-1.75-2.25c-.25-.937-.188-2.062.312-2.937M17.75 11.75l-4.875-2.812 1.687-1 4 2.312c.625.375 1.125.875 1.438 1.5s.5 1.313.437 2.063a3.7 3.7 0 0 1-.75 1.937c-.437.563-1 1-1.687 1.25v-4.75c0-.125 0-.25-.063-.312 0 0-.062-.126-.187-.188m1.687-2.5s-.062-.062-.125-.062l-4-2.313c-.125-.062-.187-.062-.312-.062s-.25 0-.313.062L9.812 9.688V7.75l4.063-2.375c.625-.375 1.312-.5 2.062-.5.688 0 1.375.25 2 .688.563.437 1.063 1 1.313 1.625s.312 1.375.187 2.062m-10.5 3.5-1.687-1V7.063c0-.688.187-1.438.562-2C8.187 4.438 8.75 4 9.375 3.688a3.37 3.37 0 0 1 2.062-.313c.688.063 1.375.375 1.938.813 0 0-.063.062-.125.062l-4 2.313a.5.5 0 0 0-.25.25c-.063.125-.063.187-.063.312zm.875-2L12 9.5l2.187 1.25v2.5L12 14.5l-2.188-1.25z' })])
  }

  return h('span', {
    'aria-hidden': 'true',
    'class': ['app-icon', iconClasses[props.name]],
  })
}
