import { createPinia } from 'pinia'
import { createApp, h } from 'vue'
import { RouterView } from 'vue-router'
import { createWorkbenchRouter } from './router'
import { applyWorkbenchTheme } from './theme'
import 'virtual:uno.css'
import './desktop.css'
import './styles.css'

const desktopPlatform = (
  window as Window & { craftHubDesktop?: { platform?: string } }
).craftHubDesktop?.platform

if (desktopPlatform)
  document.documentElement.dataset.desktopPlatform = desktopPlatform

applyWorkbenchTheme('system')

createApp({ render: () => h(RouterView) })
  .use(createPinia())
  .use(createWorkbenchRouter())
  .mount('#app')
