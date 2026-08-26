import type { ProjectAccentColor } from 'craft-hub'
import type { CSSProperties } from 'vue'

const accents: Record<ProjectAccentColor, string> = {
  blue: '#1463df',
  cyan: '#087f8c',
  green: '#238543',
  orange: '#b85c00',
  pink: '#bd3970',
  purple: '#7252c7',
  red: '#c63e42',
  yellow: '#947100',
}

export function projectAccentStyle(color?: ProjectAccentColor): CSSProperties {
  if (!color)
    return {}
  return {
    '--project-accent': accents[color],
    '--project-accent-soft': `color-mix(in srgb, ${accents[color]} 16%, var(--surface))`,
  } as CSSProperties
}
