import { createPinia } from 'pinia'
import { createApp, h } from 'vue'
import { RouterView } from 'vue-router'
import { installNativeHost } from './native-host'
import { createWorkbenchRouter } from './router'
import { applyWorkbenchTheme } from './theme'
import { trackWindowFocus } from './window-focus'
import 'virtual:uno.css'
import './desktop.css'
import './styles.css'

const desktopHost = (
  window as Window & { craftHubDesktop?: { platform?: string, windowMaterial?: string } }
).craftHubDesktop

if (desktopHost?.platform) {
  document.documentElement.dataset.desktopPlatform = desktopHost.platform
  trackWindowFocus()
}
// Only hosts that draw a native material behind the page may make workbench surfaces translucent.
if (desktopHost?.windowMaterial)
  document.documentElement.dataset.desktopWindowMaterial = desktopHost.windowMaterial

applyWorkbenchTheme('system')

const router = createWorkbenchRouter()
installNativeHost(router)

createApp({ render: () => h(RouterView) })
  .use(createPinia())
  .use(router)
  .mount('#app')
