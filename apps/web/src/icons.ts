import type { VNode } from 'vue'
import { h } from 'vue'

export type IconName = 'arrowDown' | 'arrowRight' | 'calendar' | 'chart' | 'check' | 'close' | 'cloud' | 'code' | 'codebuddy' | 'codex' | 'collection' | 'cursor' | 'database' | 'design' | 'docs' | 'drag' | 'edit' | 'error' | 'experiment' | 'folder' | 'folderOpen' | 'gitRepository' | 'hub' | 'loading' | 'mobile' | 'more' | 'package' | 'palette' | 'personal' | 'plugins' | 'plus' | 'rocket' | 'search' | 'security' | 'settings' | 'source' | 'star' | 'starFilled' | 'stop' | 'team' | 'terminal' | 'terminalApp' | 'skill' | 'play' | 'trusted' | 'untrusted' | 'refresh' | 'vscode' | 'web' | 'workspace'

export const visualIconNames = ['workspace', 'folder', 'hub', 'code', 'docs', 'design', 'database', 'package', 'rocket', 'team', 'experiment', 'security', 'cloud', 'mobile', 'web', 'terminal', 'skill', 'settings', 'calendar', 'chart'] as const satisfies readonly IconName[]

export const iconClasses: Record<Exclude<IconName, 'codebuddy' | 'codex' | 'cursor' | 'plugins' | 'vscode'>, string> = {
  arrowDown: 'i-ri-arrow-down-s-line',
  arrowRight: 'i-ri-arrow-right-s-line',
  calendar: 'i-ri-calendar-line',
  chart: 'i-ri-bar-chart-2-line',
  check: 'i-ri-checkbox-circle-fill',
  close: 'i-ri-close-line',
  cloud: 'i-ri-cloud-line',
  code: 'i-ri-code-s-slash-line',
  collection: 'i-ri-stack-line',
  database: 'i-ri-database-2-line',
  design: 'i-ri-brush-line',
  docs: 'i-ri-file-text-line',
  drag: 'i-ri-draggable',
  edit: 'i-ri-edit-line',
  error: 'i-ri-error-warning-fill',
  experiment: 'i-ri-flask-line',
  folder: 'i-ri-folder-3-line',
  folderOpen: 'i-ri-folder-open-line',
  gitRepository: 'i-ri-git-repository-line',
  hub: 'i-ri-node-tree',
  loading: 'i-svg-spinners-180-ring-with-bg',
  mobile: 'i-ri-smartphone-line',
  more: 'i-ri-more-2-fill',
  package: 'i-ri-box-3-line',
  palette: 'i-ri-palette-line',
  personal: 'i-ri-user-line',
  plus: 'i-ri-add-line',
  rocket: 'i-ri-rocket-line',
  search: 'i-ri-search-line',
  security: 'i-ri-shield-keyhole-line',
  settings: 'i-ri-settings-3-line',
  source: 'i-ri-file-search-line',
  star: 'i-ri-star-line',
  starFilled: 'i-ri-star-fill',
  stop: 'i-ri-stop-fill',
  team: 'i-ri-team-line',
  terminal: 'i-ri-terminal-box-line',
  terminalApp: 'i-ri-terminal-window-line',
  skill: 'i-ri-sparkling-2-line',
  play: 'i-ri-play-fill',
  trusted: 'i-ri-shield-check-line',
  untrusted: 'i-ri-shield-keyhole-line',
  web: 'i-ri-global-line',
  refresh: 'i-ri-refresh-line',
  workspace: 'i-ri-folders-line',
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
      'viewBox': '0 0 32 32',
    }, [
      h('path', { fill: '#0065a9', d: 'm29.01 5.03-5.766-2.776a1.74 1.74 0 0 0-1.989.338L2.38 19.8a1.166 1.166 0 0 0-.08 1.647q.037.04.077.077l1.541 1.4a1.165 1.165 0 0 0 1.489.066L28.142 5.75A1.158 1.158 0 0 1 30 6.672v-.067a1.75 1.75 0 0 0-.99-1.575' }),
      h('path', { fill: '#007acc', d: 'm29.01 26.97-5.766 2.777a1.745 1.745 0 0 1-1.989-.338L2.38 12.2a1.166 1.166 0 0 1-.08-1.647q.037-.04.077-.077l1.541-1.4A1.165 1.165 0 0 1 5.41 9.01l22.732 17.24A1.158 1.158 0 0 0 30 25.328v.072a1.75 1.75 0 0 1-.99 1.57' }),
      h('path', { fill: '#1f9cf0', d: 'M23.244 29.747a1.745 1.745 0 0 1-1.989-.338A1.025 1.025 0 0 0 23 28.684V3.316a1.024 1.024 0 0 0-1.749-.724a1.74 1.74 0 0 1 1.989-.339l5.765 2.772A1.75 1.75 0 0 1 30 6.6v18.8a1.75 1.75 0 0 1-.991 1.576Z' }),
    ])
  }

  if (props.name === 'codebuddy') {
    return h('svg', {
      'aria-hidden': 'true',
      'class': ['app-icon', 'codebuddy-icon'],
      'viewBox': '0 0 60 60',
    }, [
      h('rect', { width: '60', height: '60', rx: '12.9474', fill: '#654cff' }),
      h('path', { fill: 'white', d: 'M45.887 4.69c.588-.527.623-.548 1.054-.574.7-.05 1.34.285 2.43 1.277 2.546 2.313 6.091 7.07 8.295 11.132l.852 1.576 1.202.598c1.161.587 3.066 1.789 3.862 2.435.36.297.41.303.784.158 1.689-.658 4.107.214 6.24 2.26 1.921 1.841 3.76 4.986 4.464 7.61.103.423.24 1.33.289 2.007.16 2.374-.6 4.27-2.067 5.13-.3.172-.32.219-.31.966.067 3.556-.892 7.106-2.818 10.568-2.174 3.887-6.044 7.907-11.283 11.695-2.813 2.048-9.469 5.926-12.478 7.287-7.209 3.246-12.987 4.49-18.007 3.875-2.994-.362-6.383-1.531-8.388-2.888-.528-.365-.612-.386-1.015-.271-2.146.617-4.958-.651-7.346-3.302-.952-1.06-2.49-3.661-2.988-5.054-1.153-3.258-.924-6.199.612-7.955.396-.453.41-.472.323-1.233a25 25 0 0 1-.09-4.277l.052-1.11-1.668-2.95c-2.582-4.595-4.222-8.454-4.855-11.402-.334-1.616-.314-2.333.096-2.864.25-.32 1.069-.652 2.057-.834 2.485-.437 7.907-.042 13.938 1.023l.627.108 1.376-1.218c2.286-2.024 3.804-3.16 6.603-4.905 2.917-1.826 6.21-3.327 9.919-4.516l1.19-.381.653-1.717c2.341-6.181 4.739-10.738 6.449-12.254ZM26.275 36.364c-2.647 1.527-3.97 2.291-4.942 3.147-3.937 3.467-5.409 8.959-3.733 13.93.414 1.227 1.178 2.55 2.706 5.197 1.528 2.646 2.292 3.97 3.148 4.942 3.467 3.937 8.958 5.408 13.93 3.732 1.227-.414 2.55-1.178 5.196-2.706l15.223-8.789c2.647-1.528 3.97-2.291 4.942-3.148 3.937-3.466 5.409-8.958 3.733-13.93-.414-1.227-1.179-2.55-2.706-5.196-1.528-2.646-2.292-3.97-3.148-4.942-3.467-3.937-8.958-5.409-13.93-3.732-1.227.414-2.55 1.178-5.196 2.706Z' }),
      h('rect', { x: '27.743', y: '47', width: '6.014', height: '12.49', rx: '3.007', transform: 'rotate(-30 27.743 47)', fill: 'white' }),
      h('rect', { x: '43.969', y: '37.633', width: '6.014', height: '12.49', rx: '3.007', transform: 'rotate(-30 43.969 37.633)', fill: 'white' }),
    ])
  }

  if (props.name === 'cursor') {
    return h('svg', {
      'aria-hidden': 'true',
      'class': ['app-icon', 'cursor-icon'],
      'fill': 'currentColor',
      'viewBox': '0 0 128 128',
    }, [
      h('path', { d: 'm64 128 55.6-32L64 64 8.4 96Z', opacity: '.42' }),
      h('path', { d: 'M119.6 96V32L64 0v64Z', opacity: '.68' }),
      h('path', { d: 'M64 0 8.4 32v64L64 64Z', opacity: '.82' }),
      h('path', { d: 'M119.6 32 64 128V64Z', opacity: '.56' }),
      h('path', { d: 'M119.6 32 64 64 8.4 32Z' }),
    ])
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
