<script setup lang="ts">
import { RouterLink } from 'vue-router'
import EnvironmentSourceConnection from './EnvironmentSourceConnection.vue'
import { useI18n } from './i18n'
import WorkbenchViewFrame from './WorkbenchViewFrame.vue'

const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
</script>

<template>
  <WorkbenchViewFrame :title="copy('配置源连接', 'Source connections')" :description="copy('连接配置仓库，再到环境配置中审阅和应用。', 'Connect a configuration repository, then review and apply it in Environment configuration.')" icon="builtin:settings">
    <template #actions><RouterLink class="workbench-action-link" to="/marketplace">{{ copy('管理插件', 'Manage plugins') }}</RouterLink></template>
    <EnvironmentSourceConnection standalone />
  </WorkbenchViewFrame>
</template>
