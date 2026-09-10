<script setup lang="ts">
import type { WorkspaceSourceCatalog } from 'craft-hub'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from './components/ui/button'
import { Icon } from './icons'
import { useI18n } from './i18n'

const props = defineProps<{ disabled?: boolean, sources?: { url: string, applied: boolean }[] }>()
const savedSource = (url: string) => props.sources?.find(source => source.url.replace(/\/$/, '') === url.replace(/\/$/, ''))
function repositoryLabel(value: string): string {
  const url = new URL(value)
  return `${url.hostname}${url.pathname.split('/tree/')[0]}`
}
const emit = defineEmits<{ select: [url: string], join: [url: string] }>()
const { locale } = useI18n()
const text = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const catalogs = ref<WorkspaceSourceCatalog[]>([])
const route = useRoute()
const router = useRouter()
const query = computed({ get: () => String(route.query.search || ''), set: value => { void router.replace({ query: { ...route.query, search: value || undefined } }) } })
const market = computed({ get: () => String(route.query.market || ''), set: value => { void router.replace({ query: { ...route.query, market: value || undefined } }) } })
const visibleCatalogs = computed(() => catalogs.value.filter(catalog => !market.value || catalog.id === market.value).map(catalog => ({ ...catalog, entries: catalog.entries.filter(entry => [entry.name, entry.publisher, entry.description, entry.configurationUrl].some(value => value?.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()))) })))
const resultCount = computed(() => visibleCatalogs.value.reduce((total, catalog) => total + catalog.entries.length, 0))
const available = ref(true)
const loading = ref(false)
const error = ref('')
async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = await fetch('/api/workspace-catalogs')
    if ([403, 404].includes(response.status) || (response.ok && !response.headers.get('content-type')?.includes('application/json'))) {
      available.value = false
      return
    }
    available.value = true
    if (!response.ok)
      throw new Error(text('工作区源目录暂时不可用', 'Workspace source catalog unavailable'))
    catalogs.value = await response.json()
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    loading.value = false
  }
}
onMounted(() => void load())
</script>

<template>
  <section v-if="available" class="workspace-source-catalog" aria-labelledby="workspace-source-catalog-title">
    <header>
      <div><h2 id="workspace-source-catalog-title">{{ text('发现共享工作区', 'Discover shared workspaces') }}</h2><p>{{ text('订阅团队或个人维护的源，选择需要的工作区。', 'Subscribe to sources maintained by teams and individuals, then choose your workspaces.') }}</p></div>
      <Button :disabled="loading" @click="load">{{ text('刷新目录', 'Refresh catalog') }}</Button>
    </header>
    <div class="catalog-filters">
      <label class="catalog-search">{{ text('搜索源', 'Search sources') }}<input v-model="query" type="search" :placeholder="text('名称、维护者或仓库地址', 'Name, publisher or repository')"></label>
      <label>{{ text('市场', 'Market') }}<select v-model="market"><option value="">{{ text('全部市场', 'All markets') }}</option><option v-for="catalog in catalogs" :key="catalog.id" :value="catalog.id">{{ catalog.name }}</option></select></label>
    </div>
    <p v-if="loading" role="status">{{ text('正在读取目录…', 'Loading catalog…') }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-else-if="!loading && !resultCount" class="catalog-empty" role="status">
      <Icon name="workspace" />
      <strong>{{ query || market ? text('没有匹配的配置源', 'No matching sources') : text('暂无已上架的工作区源', 'No published workspace sources') }}</strong>
      <p>{{ query || market ? text('试试其他关键词或市场筛选。', 'Try another search or market filter.') : text('你也可以通过添加源输入配置仓库链接。', 'You can also add a source using its repository URL.') }}</p>
    </div>
    <p v-if="!loading && resultCount" class="result-count">{{ resultCount }} {{ text('个可用源', 'available sources') }}</p>
    <section v-for="catalog in visibleCatalogs.filter(item => item.entries.length)" :key="catalog.id" class="catalog-group">
      <h3>{{ catalog.name }} <span>{{ catalog.entries.length }}</span></h3>
      <div class="source-list">
        <article v-for="entry in catalog.entries" :key="entry.id" class="source-entry">
          <div class="source-symbol" aria-hidden="true"><Icon name="workspace" /></div>
          <div class="source-information">
            <div class="source-heading"><h4>{{ entry.name }}</h4><span v-if="savedSource(entry.configurationUrl)" class="source-status">{{ savedSource(entry.configurationUrl)?.applied ? text('已订阅', 'Subscribed') : text('已保存', 'Saved') }}</span></div>
            <p class="source-description">{{ entry.description || text('从共享仓库获取工作区与项目配置。', 'Workspace and project definitions from a shared repository.') }}</p>
            <div class="source-meta"><span>{{ entry.publisher }}</span><span aria-hidden="true">·</span><a :href="entry.configurationUrl" target="_blank" rel="noopener noreferrer" :title="entry.configurationUrl">{{ repositoryLabel(entry.configurationUrl) }} ↗</a></div>
          </div>
          <Button :disabled="disabled" :variant="savedSource(entry.configurationUrl) ? 'secondary' : 'primary'" @click="entry.team && !savedSource(entry.configurationUrl)?.applied ? emit('join', entry.configurationUrl) : emit('select', entry.configurationUrl)">{{ entry.team && !savedSource(entry.configurationUrl)?.applied ? text('加入团队', 'Join Team') : savedSource(entry.configurationUrl)?.applied ? text('预览更新', 'Preview updates') : text('预览订阅', 'Preview subscription') }}</Button>
        </article>
      </div>
    </section>
  </section>
  <p v-else role="status">{{ text('当前宿主未提供可浏览的目录，请通过添加源输入仓库链接。', 'This host has no browsable catalog. Add a source using its repository URL.') }}</p>
</template>

<style scoped>
.workspace-source-catalog { margin-top: 0; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
h2 { margin: 0; font-size: var(--page-section-title-size); } h3 { display: flex; align-items: center; gap: 10px; font-size: var(--font-size-body); margin: var(--page-section-gap) 0 var(--space-2); color: var(--text-secondary); }
h3 span { color: var(--muted); font-weight: 400; } h4 { font-size: var(--font-size-emphasis); margin: 0; overflow-wrap: anywhere; }
p { color: var(--muted); font-size: var(--font-size-body); line-height: 1.6; margin: 6px 0; }
.catalog-filters { display: flex; align-items: end; gap: 16px; margin-top: var(--space-4); padding: var(--space-3); background: var(--surface); border: 1px solid var(--border); border-radius: var(--control-radius); }
.catalog-filters label { display: grid; gap: 8px; font-size: 12px; color: var(--text-secondary); min-width: 0; }
.catalog-search { flex: 1; } input, select { width: 100%; min-width: 0; border: 1px solid var(--border); border-radius: 6px; min-height: var(--page-toolbar-height); padding: 5px 10px; color: var(--text); background: var(--surface); }
input:focus-visible, select:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.source-list { border: 1px solid var(--border); border-radius: var(--control-radius); overflow: hidden; background: var(--surface); }
.source-entry { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: var(--space-3); padding: var(--space-4); }
.source-entry + .source-entry { border-top: 1px solid var(--border); }
.source-entry:hover { background: var(--surface-hover); }
.source-symbol { display: grid; place-items: center; width: 42px; height: 42px; border-radius: var(--control-radius); color: var(--accent); background: color-mix(in srgb, var(--accent) 9%, var(--surface)); }
.source-symbol :deep(svg) { width: 22px; height: 22px; }
.source-heading, .source-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.source-status { border: 1px solid var(--border); border-radius: 5px; padding: 2px 6px; font-size: 11px; color: var(--accent); }
.source-description { color: var(--text-secondary); overflow-wrap: anywhere; }
.source-meta { font-size: 12px; color: var(--muted); }
.source-meta a { color: var(--muted); overflow-wrap: anywhere; text-decoration: none; }.source-meta a:hover { color: var(--accent); text-decoration: underline; }
.result-count { margin-top: 16px; }
.catalog-empty { display: grid; justify-items: center; text-align: center; padding: 40px 16px; gap: 8px; color: var(--muted); }
.catalog-empty :deep(svg) { width: 28px; height: 28px; }.catalog-empty strong { font-size: 14px; color: var(--text); }
[role=alert] { color: var(--danger, #c44); }
@media (max-width: 720px) {
  header { align-items: flex-start; flex-wrap: wrap; }.catalog-filters { flex-direction: column; align-items: stretch; }
  .source-entry { grid-template-columns: 32px minmax(0, 1fr); gap: 12px; padding: 16px; }.source-symbol { width: 32px; height: 32px; }
  .source-entry > button { grid-column: 2; justify-self: start; }
}
</style>
