import type { Router, RouterHistory } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'

export function createWorkbenchRouter(history: RouterHistory = createWebHistory()): Router {
  return createRouter({
    history,
    routes: [
      { path: '/', name: 'workbench', component: App },
      { path: '/subscriptions', name: 'subscriptions', component: App },
      { path: '/subscriptions/discover', name: 'subscriptions-discover', component: App },
      { path: '/subscriptions/new', name: 'subscriptions-new', component: App },
      { path: '/subscriptions/preview', name: 'subscriptions-preview', component: App },
      { path: '/subscriptions/:subscriptionId', name: 'subscriptions-detail', component: App },
      { path: '/navigation', name: 'navigation', component: App },
      { path: '/diagnostics', name: 'diagnostics', component: App },
      { path: '/workbenches/:pluginId/:workbenchId', name: 'plugin-workbench', component: App },
      { path: '/integrations/:integrationId/:viewId', name: 'integration', component: App },
      { path: '/marketplace', name: 'marketplace', component: App },
      { path: '/marketplace/plugins/:sourceId/:packageName', name: 'plugin-detail', component: App },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
  })
}
