import { defineConfig, presetIcons } from 'unocss'

export default defineConfig({
  content: {
    filesystem: ['src/**/*.{ts,vue}'],
  },
  presets: [
    presetIcons({
      extraProperties: {
        'display': 'inline-block',
        'vertical-align': 'middle',
      },
    }),
  ],
  safelist: [
    'i-ri-add-line',
    'i-ri-arrow-down-s-line',
    'i-ri-arrow-right-s-line',
    'i-ri-checkbox-circle-fill',
    'i-ri-close-line',
    'i-ri-draggable',
    'i-ri-error-warning-fill',
    'i-ri-file-search-line',
    'i-ri-folder-3-line',
    'i-ri-loader-4-line',
    'i-ri-layout-grid-line',
    'i-ri-node-tree',
    'i-ri-palette-line',
    'i-ri-play-fill',
    'i-ri-search-line',
    'i-ri-settings-3-line',
    'i-ri-shield-check-line',
    'i-ri-shield-keyhole-line',
    'i-ri-sparkling-2-line',
    'i-ri-star-fill',
    'i-ri-star-line',
    'i-ri-stack-line',
    'i-ri-stop-fill',
    'i-ri-terminal-box-line',
    'i-ri-terminal-window-line',
  ],
})
