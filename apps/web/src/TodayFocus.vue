<script setup lang="ts">
import type { FocusAnalysis } from 'craft-hub'
import type { FocusEntry } from './today-focus'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { SkeletonList } from './components/ui/skeleton'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { formatShortcut } from './shortcuts'
import { workItemTypeIcon } from './work-item-presentation'
import VisualIcon from './VisualIcon.vue'
import { localDateTime } from './quick-capture'
import { focusCandidates, rankTodayFocus } from './today-focus'

const props = defineProps<{ entries: FocusEntry[], coverage: string, loading: boolean, wide?: boolean }>()
const emit = defineEmits<{ capture: [], refresh: [], handoff: [entry: FocusEntry] }>()
const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const windowPlatform = window.craftHubDesktop?.platform ?? navigator.platform
const now = ref(Date.now())
const ranked = computed(() => rankTodayFocus(props.entries, now.value, locale.value === 'zh-CN'))
const candidates = computed(() => focusCandidates(ranked.value))
const snapshot = computed(() => JSON.stringify([candidates.value, props.coverage, new Date(now.value).toDateString(), locale.value]))
const available = ref(false)
const analyzing = ref(false)
const analysis = ref<FocusAnalysis>()
const analyzedAt = ref('')
const error = ref('')
const expanded = ref(false)
let generation = 0
let timer: ReturnType<typeof setInterval> | undefined
const rows = computed(() => analysis.value
  ? analysis.value.items.flatMap(recommendation => { const entry = ranked.value.find(item => item.key === recommendation.key); return entry ? [{ ...entry, reason: recommendation.reason, nextStep: recommendation.nextStep }] : [] })
  : ranked.value.slice(0, 3).map(entry => ({ ...entry, reason: entry.reasons.join(' · '), nextStep: '' })))
const visibleRows = computed(() => expanded.value ? rows.value : rows.value.slice(0, 3))
watch(snapshot, () => { expanded.value = false; generation++; analysis.value = undefined; analyzedAt.value = ''; error.value = '' })
async function analyze(): Promise<void> {
  if (analyzing.value || props.loading || !candidates.value.length) return
  analyzing.value = true
  error.value = ''
  const version = generation
  try {
    const result = await api.analyzeFocus({ candidates: candidates.value, localNow: localDateTime(), locale: locale.value, coverage: `${props.coverage}; ${ranked.value.length} loaded personal items, ${candidates.value.length} ranked candidates supplied.` })
    if (version !== generation) { error.value = copy('事项已变化，请重新分析。', 'Work items changed. Analyze again.'); return }
    analysis.value = result
    analyzedAt.value = new Date().toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
  }
  catch { error.value = copy('AI 分析暂不可用，已保留按日期和优先级排列的结果。请检查 Codex 登录后重试。', 'AI is unavailable. Date and priority ordering remains available. Check your Codex connection and retry.') }
  finally { analyzing.value = false }
}
onMounted(() => {
  void api.workAssistantStatus().then(status => available.value = status.available).catch(() => {})
  timer = setInterval(() => { now.value = Date.now() }, 60_000)
})
onUnmounted(() => { generation++; clearInterval(timer) })
</script>

<template>
  <section class="today-focus" :class="{ 'is-wide': wide }" :aria-label="copy('今日重点', 'Today’s focus')">
    <header class="focus-heading">
      <div class="focus-title"><Icon name="sun" /><h2>{{ copy('今日重点', 'Today’s focus') }}</h2><time>{{ new Date(now).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' }) }}</time></div>
      <UiButton variant="ghost" size="compact" :title="formatShortcut('Mod+Shift+Space', windowPlatform)" @click="emit('capture')"><Icon name="plus" />{{ copy('快速记录', 'Quick capture') }}</UiButton>
    </header>
    <div class="focus-toolbar">
      <span>{{ analysis ? `${copy('AI 建议', 'AI suggestions')} · ${analyzedAt}` : copy('截止时间与优先级', 'Deadlines & priority') }}</span>
      <div><UiButton variant="ghost" size="compact" :disabled="loading || analyzing || !ranked.length || !available" @click="analyze"><Icon :name="analyzing ? 'loading' : 'skill'" />{{ analyzing ? copy('分析中…', 'Analyzing…') : copy('AI 分析', 'AI analysis') }}</UiButton><UiButton variant="ghost" size="icon" :disabled="loading" :aria-label="copy('刷新今日重点', 'Refresh today’s focus')" @click="emit('refresh')"><Icon :name="loading ? 'loading' : 'refresh'" /></UiButton></div>
    </div>
    <ol v-if="rows.length" class="focus-list motion-reveal-list">
      <li v-for="(row, index) in visibleRows" :key="`${snapshot}:${row.key}`">
        <span class="focus-number">{{ index + 1 }}</span>
        <details class="focus-item">
          <summary :title="row.item.title">
            <span class="focus-item-copy"><strong>{{ row.item.title }}</strong><small><VisualIcon :icon="row.source.icon" :fallback="workItemTypeIcon(row.item)" />{{ row.item.project?.title || row.source.title }}<span v-if="row.item.statusLabel">· {{ row.item.statusLabel }}</span></small></span>
            <Icon name="arrowRight" class="focus-disclosure" />
          </summary>
          <div class="focus-detail"><p>{{ row.reason }}</p><p v-if="row.nextStep" class="focus-next">{{ copy('下一步：', 'Next: ') }}{{ row.nextStep }}</p><UiButton variant="ghost" size="compact" @click="emit('handoff', row)"><Icon name="copy" />{{ copy('准备交接', 'Prepare handoff') }}</UiButton></div>
        </details>
      </li>
    </ol>
    <SkeletonList v-else-if="loading" class="focus-skeleton" :label="copy('正在汇总…', 'Reading sources…')" />
    <p v-else class="focus-empty motion-reveal" role="status">{{ copy('暂无未完成事项，记录一件事开始吧。', 'No unfinished work. Capture a task to get started.') }}</p>
    <UiButton v-if="rows.length > 3" variant="ghost" size="compact" class="focus-more" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? copy('收起', 'Show less') : copy(`另 ${rows.length - 3} 项建议`, `${rows.length - 3} more suggestions`) }}<Icon name="arrowDown" /></UiButton>
    <p v-if="error" class="focus-warning" role="alert">{{ error }}</p>
    <details class="focus-context">
      <summary><span>{{ ranked.length }} {{ copy('项待办', 'tasks') }} · {{ copy('分析范围', 'Analysis scope') }}</span><Icon name="arrowDown" /></summary>
      <p v-if="analysis?.summary" class="focus-summary">{{ analysis.summary }}</p>
      <p>{{ coverage }}<span v-if="ranked.length > 80"> · {{ copy('AI 分析跨来源选出的 80 个候选事项', 'AI analyzes 80 candidates across sources') }}</span><span v-if="!available"> · {{ copy('在桌面版连接 Codex 可启用 AI 分析', 'Connect Codex in the desktop app for AI analysis') }}</span></p>
    </details>
  </section>
</template>

<style scoped>
.today-focus { padding: 10px 16px 0; border: 1px solid var(--border); border-radius: var(--panel-radius); background: var(--surface); margin-bottom: 16px; }
.today-focus.is-wide { container: focus-overview / inline-size; }
.focus-heading, .focus-title, .focus-toolbar, .focus-toolbar > div { display: flex; align-items: center; gap: 8px; }
.focus-heading, .focus-toolbar { justify-content: space-between; }
.focus-title { min-width: 0; }
.focus-title > .app-icon { flex: none; width: 18px; height: 18px; color: var(--accent); }
.focus-title h2 { margin: 0; font-size: 16px; letter-spacing: -.3px; font-weight: 600; white-space: nowrap; }
.focus-title time { color: var(--muted); font-size: 11px; white-space: nowrap; }
.focus-heading > button { flex: none; color: var(--accent); }
.focus-toolbar { font-size: 11px; color: var(--muted); border-bottom: 1px solid var(--border); padding: 2px 0; }
.focus-toolbar > div { flex: none; gap: 0; }
.focus-toolbar .ui-button--icon { width: 28px; height: 28px; }
.focus-list { list-style: none; padding: 0; margin: 0; }
.focus-list li { display: flex; align-items: flex-start; gap: 10px; border-bottom: 1px solid var(--border); }
.focus-list li:last-child { border-bottom: 0; }
.focus-number { flex: none; width: 12px; padding-top: 10px; text-align: center; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.focus-item { flex: 1; min-width: 0; }
.focus-item summary { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 6px 0; cursor: pointer; box-sizing: border-box; }
.focus-item-copy { min-width: 0; flex: 1; }
.focus-item strong { display: block; font-size: 13px; font-weight: 500; line-height: 19px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.focus-item[open] strong { white-space: normal; overflow-wrap: anywhere; }
.focus-item small { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 11px; line-height: 16px; overflow: hidden; white-space: nowrap; }
.focus-item small .visual-icon { flex: none; width: 12px; height: 12px; }
.focus-disclosure { flex: none; width: 14px; height: 14px; color: var(--muted); transition: transform var(--motion-duration-enter) var(--motion-ease-standard); }
.focus-item[open] .focus-disclosure { transform: rotate(90deg); }
.focus-detail { padding: 0 0 10px; }
.focus-detail p { margin: 0 0 6px; color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.focus-detail .focus-next { color: var(--text); }
.focus-detail button { padding-left: 0; color: var(--accent); }
.focus-context { border-top: 1px solid var(--border); font-size: 11px; color: var(--muted); line-height: 1.6; }
.focus-context summary { display: flex; align-items: center; justify-content: space-between; min-height: 32px; cursor: pointer; }
.focus-context summary .app-icon { width: 14px; height: 14px; transition: transform var(--motion-duration-enter) var(--motion-ease-standard); }
/* Disclosures expand to their content height where the engine supports animating to auto; others open instantly. */
.today-focus { interpolate-size: allow-keywords; }
:is(.focus-item, .focus-context)::details-content { block-size: 0; overflow: hidden; transition: block-size var(--motion-duration-enter) var(--motion-ease-standard), content-visibility var(--motion-duration-enter) allow-discrete; }
:is(.focus-item, .focus-context)[open]::details-content { block-size: auto; }
.focus-context[open] summary .app-icon { transform: rotate(180deg); }
.focus-context p { margin: 0 0 10px; }
.focus-context .focus-summary { color: var(--text); font-size: 12px; }
@container focus-overview (min-width: 760px) {
  .focus-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 16px; padding-block: 6px; }
  .focus-list li { min-width: 0; border-bottom: 0; }
  .focus-list li:not(:nth-child(3n+1)) { border-left: 1px solid var(--border); padding-left: 16px; }
  .focus-item summary { min-height: 52px; }
  .focus-item strong { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; white-space: normal; }
  .focus-item[open] strong { display: block; }
  .focus-skeleton { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 16px; padding-block: 6px; --skeleton-row-height: 52px; --skeleton-row-divider: 0; }
  .focus-skeleton .ui-skeleton-row:not(:first-of-type) { border-left: 1px solid var(--border); padding-left: 38px; }
}
summary { list-style: none; }
summary::-webkit-details-marker { display: none; }
summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; border-radius: 4px; }
.focus-more { width: 100%; color: var(--accent); }
.focus-warning { font-size: 12px; line-height: 1.5; color: var(--warning); }
.focus-empty { padding: 12px 0; color: var(--muted); font-size: 12px; }
/* Mirror the ranked rows: number column, title and source caption. */
.focus-skeleton { --skeleton-row-padding: 6px 0 6px 22px; }
@media (max-width: 400px) { .today-focus { padding-inline: 12px; } .focus-title time { display: none; } }
</style>
