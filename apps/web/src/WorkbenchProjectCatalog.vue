<script setup lang="ts">
import { ref } from 'vue'
import { Button as UiButton } from './components/ui/button'
import { SkeletonList } from './components/ui/skeleton'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'
import WorkHandoffDialog from './WorkHandoffDialog.vue'

const emit = defineEmits<{ openProject: [projectId: string] }>()
const store = useWorkbenchStore()
const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const handoffOpen = ref(false)
const handoffProjectId = ref('')
</script>

<template>
  <section class="host-project-catalog daily-section">
    <div v-if="store.projectsLoadState === 'error'" class="daily-surface daily-empty" role="alert">
      <strong>{{ copy('项目未载入', 'Projects could not be loaded') }}</strong>
      <UiButton size="compact" @click="store.loadProjects()">{{ copy('重试', 'Retry') }}</UiButton>
    </div>
    <div v-else-if="['idle', 'loading'].includes(store.projectsLoadState)" class="daily-surface"><SkeletonList :label="copy('正在读取项目…', 'Loading projects…')" icon /></div>
    <div v-else-if="!store.projects.length" class="daily-surface daily-empty">
      <Icon name="folder" /><strong>{{ copy('添加你的项目', 'Add your projects') }}</strong>
      <p class="daily-caption">{{ copy('先在项目与工作区中添加本机项目。', 'Add a local project in Projects and workspaces first.') }}</p>
    </div>
    <div v-if="store.projects.length" class="daily-surface daily-list motion-reveal-list">
      <article v-for="project in store.projects" :key="project.id" class="daily-row">
        <button class="daily-row-main" :data-testid="`open-project-${project.id}`" :aria-label="`${copy('打开项目', 'Open project')} ${project.name}`" @click="emit('openProject', project.id)">
          <Icon name="folder" />
          <span class="daily-row-copy">
            <strong class="daily-row-title">{{ project.name }}</strong>
            <span class="daily-row-meta" :title="project.path">{{ project.path }}</span>
          </span>
          <Icon name="arrowRight" />
        </button>
        <UiButton variant="ghost" size="icon" :aria-label="`${copy('准备交接', 'Prepare handoff')} ${project.name}`" @click="handoffProjectId = project.id; handoffOpen = true"><Icon name="copy" /></UiButton>
      </article>
    </div>
  </section>
  <WorkHandoffDialog v-model:open="handoffOpen" :initial-project-id="handoffProjectId" />
</template>

<style scoped>
.host-project-catalog { min-width: 0; }
</style>
