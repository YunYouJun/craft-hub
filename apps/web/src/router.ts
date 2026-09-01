import type { Router, RouterHistory } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'

export function createWorkbenchRouter(history: RouterHistory = createWebHistory()): Router {
  return createRouter({
    history,
    routes: [
      { path: '/', name: 'workbench', component: App },
      { path: '/marketplace', name: 'marketplace', component: App },
      { path: '/marketplace/plugins/:sourceId/:packageName', name: 'plugin-detail', component: App },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
  })
}
