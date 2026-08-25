import type { VNode } from 'vue'
import { h } from 'vue'

export function Icon(props: { name: 'folder' | 'hub' | 'plus' | 'search' | 'terminal' | 'skill' | 'play' | 'shield' }): VNode {
  const paths: Record<typeof props.name, string> = {
    folder: 'M3 6.5h6l2 2h10v10H3z',
    hub: 'M7 7 12 12m5-5-5 5m0 0 5 5m-5-5-5 5',
    plus: 'M12 5v14M5 12h14',
    search: 'm20 20-4.4-4.4m2.4-5.1a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z',
    terminal: 'm6 8 4 4-4 4m6 0h6',
    skill: 'm12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5ZM18.5 16l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7Z',
    play: 'm9 6 9 6-9 6Z',
    shield: 'M12 3 5.5 6v5c0 4.3 2.7 7.8 6.5 10 3.8-2.2 6.5-5.7 6.5-10V6Z',
  }
  const children = [h('path', { d: paths[props.name] })]
  if (props.name === 'hub')
    children.push(...[[7, 7], [17, 7], [12, 12], [7, 17], [17, 17]].map(([cx, cy]) => h('circle', { cx, cy, r: 2.2, fill: 'currentColor', stroke: 'none' })))
  return h('svg', { 'viewBox': '0 0 24 24', 'fill': 'none', 'stroke': 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, children)
}
