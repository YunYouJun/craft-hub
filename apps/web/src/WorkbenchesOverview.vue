<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { Button as UiButton } from './components/ui/button'
import { useI18n } from './i18n'
import Icon from './NavigationIcon.vue'
import { useWorkbenchStore } from './store'
import VisualIcon from './VisualIcon.vue'
import { isEnvironmentView } from './workbench-navigation'
import WorkbenchViewFrame from './WorkbenchViewFrame.vue'

const store = useWorkbenchStore()
const router = useRouter()
const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const integrationViews = computed(() => store.standaloneIntegrationViews.filter(view => !isEnvironmentView(view)))
const empty = computed(() => !store.pluginWorkbenches.length && !integrationViews.value.length)
</script>

<template>
  <WorkbenchViewFrame
    class="workbenches-overview"
    :title="copy('工作台', 'Workbenches')"
    :description="copy('按工作用途访问已接入的功能。', 'Access connected features for your work.')"
    icon="builtin:briefcase"
  >
    <template #actions>
      <UiButton size="compact" @click="router.push('/marketplace')"><Icon name="plugins" />{{ copy('插件管理', 'Manage plugins') }}</UiButton>
    </template>

    <section v-if="store.pluginWorkbenches.length" class="workbenches-section" :aria-label="copy('已安装工作台', 'Installed workbenches')">
      <h2>{{ copy('已安装工作台', 'Installed workbenches') }}</h2>
      <div class="workbenches-grid">
        <RouterLink
          v-for="workbench in store.pluginWorkbenches"
          :key="`${workbench.pluginId}:${workbench.id}`"
          :to="{ name: 'plugin-workbench', params: { pluginId: workbench.pluginId, workbenchId: workbench.id } }"
          class="workbench-entry"
          :data-testid="`workbench-entry-${workbench.id}`"
        >
          <VisualIcon :icon="workbench.icon" fallback="briefcase" />
          <span class="workbench-entry-copy">
            <strong>{{ workbench.title }}</strong>
            <span v-if="workbench.description" class="workbench-entry-description">{{ workbench.description }}</span>
            <span class="workbench-entry-meta">{{ workbench.pluginName }}</span>
          </span>
          <Icon name="arrowRight" />
        </RouterLink>
      </div>
    </section>

    <section v-if="integrationViews.length" class="workbenches-section" :aria-label="copy('独立集成', 'Standalone integrations')">
      <h2>{{ copy('独立集成', 'Standalone integrations') }}</h2>
      <div class="workbenches-grid">
        <RouterLink
          v-for="view in integrationViews"
          :key="`${view.pluginId}:${view.integrationId}:${view.id}`"
          :to="{ name: 'integration', params: { integrationId: view.integrationId, viewId: view.id }, query: view.scope === 'project' ? {} : { scope: 'global' } }"
          class="workbench-entry"
          :data-testid="`integration-entry-${view.integrationId}-${view.id}`"
        >
          <VisualIcon :icon="view.icon" fallback="plugins" />
          <span class="workbench-entry-copy">
            <strong>{{ view.title }}</strong>
            <span v-if="view.scope === 'project'" class="workbench-entry-meta">{{ copy('需要项目', 'Requires a project') }}</span>
          </span>
          <Icon name="arrowRight" />
        </RouterLink>
      </div>
    </section>

    <div v-if="empty && ['idle', 'loading'].includes(store.integrationsLoadState)" class="workbenches-state" role="status">
      <Icon name="loading" />
      <p>{{ copy('正在读取工作台…', 'Loading workbenches…') }}</p>
    </div>
    <div v-else-if="store.integrationsLoadState === 'error'" class="workbenches-state" role="alert">
      <Icon name="error" />
      <strong>{{ copy('集成未载入', 'Integrations could not be loaded') }}</strong>
      <p>{{ copy('重试以读取已安装插件提供的功能。', 'Retry to load features from installed plugins.') }}</p>
      <UiButton size="compact" @click="store.loadIntegrations()">{{ copy('重试', 'Retry') }}</UiButton>
    </div>
    <div v-else-if="empty" class="workbenches-state">
      <Icon name="briefcase" />
      <strong>{{ copy('接入你的工作台', 'Connect your workbenches') }}</strong>
      <p>{{ copy('安装插件后，在这里访问工作台和独立集成。', 'Install plugins to access workbenches and standalone integrations here.') }}</p>
      <UiButton size="compact" @click="router.push('/marketplace')">{{ copy('浏览插件', 'Browse plugins') }}</UiButton>
    </div>
  </WorkbenchViewFrame>
</template>

<style scoped>
.workbenches-section + .workbenches-section { margin-top: var(--space-6); }
.workbenches-section h2 { margin: 0 0 var(--space-3); color: var(--text); font-size: var(--font-size-body); font-weight: 600; }
.workbenches-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: var(--space-3); }
.workbench-entry { display: flex; align-items: center; gap: var(--space-3); min-width: 0; padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--control-radius); color: var(--text); background: var(--surface); text-decoration: none; }
.workbench-entry:hover { border-color: var(--accent); background: var(--surface-hover); }
.workbench-entry:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.workbench-entry > .visual-icon { width: 28px; height: 28px; flex: none; color: var(--accent); }
.workbench-entry > .app-icon { width: var(--control-icon-size); height: var(--control-icon-size); flex: none; color: var(--text-secondary); }
.workbench-entry-copy { display: grid; flex: 1; min-width: 0; gap: var(--space-1); overflow-wrap: anywhere; }
.workbench-entry-copy strong { font-size: var(--font-size-body); font-weight: 600; }
.workbench-entry-description { color: var(--text-secondary); font-size: var(--font-size-body); line-height: var(--line-height-body); }
.workbench-entry-meta { color: var(--muted); font-size: var(--font-size-caption); }
.workbenches-state { display: grid; align-content: center; justify-items: center; gap: var(--space-3); min-height: 240px; padding: var(--space-6) var(--space-4); color: var(--muted); text-align: center; }
.workbenches-state > .app-icon { width: 28px; height: 28px; }
.workbenches-state strong { color: var(--text); font-size: var(--font-size-body); }
.workbenches-state p { margin: 0; font-size: var(--font-size-body); line-height: var(--line-height-body); }
.workbenches-state[role='alert'] > .app-icon { color: var(--danger); }
</style>
