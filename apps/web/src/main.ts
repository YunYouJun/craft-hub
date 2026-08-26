import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
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

createApp(App).use(createPinia()).mount('#app')
