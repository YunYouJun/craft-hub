import type { WorkbenchTheme } from 'craft-hub'
import { readonly, ref } from 'vue'

export type EffectiveTheme = Exclude<WorkbenchTheme, 'system'>

const darkMedia = window.matchMedia('(prefers-color-scheme: dark)')
const selectedTheme = ref<WorkbenchTheme>('system')
const effectiveTheme = ref<EffectiveTheme>(darkMedia.matches ? 'dark' : 'light')

function resolveTheme(theme: WorkbenchTheme): EffectiveTheme {
  return theme === 'system' ? darkMedia.matches ? 'dark' : 'light' : theme
}

function renderTheme(): void {
  effectiveTheme.value = resolveTheme(selectedTheme.value)
  document.documentElement.dataset.theme = effectiveTheme.value
  document.documentElement.style.colorScheme = effectiveTheme.value
}

darkMedia.addEventListener('change', () => {
  if (selectedTheme.value === 'system')
    renderTheme()
})

/** Apply a persisted workbench theme to the browser and desktop shell. */
export function applyWorkbenchTheme(theme: WorkbenchTheme): void {
  selectedTheme.value = theme
  renderTheme()
  void window.craftHubDesktop?.setTheme?.(theme)
}

export const workbenchTheme = readonly(selectedTheme)
export const resolvedWorkbenchTheme = readonly(effectiveTheme)
