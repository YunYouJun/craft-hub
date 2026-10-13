<script setup lang="ts">
import type { FocusEntry } from './today-focus'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Button as UiButton } from './components/ui/button'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { workItemTypeIcon } from './work-item-presentation'
import VisualIcon from './VisualIcon.vue'
import { rankTodayFocus } from './today-focus'

const props = defineProps<{ entries: FocusEntry[], coverage: string, loading: boolean, wide?: boolean }>()
const emit = defineEmits<{ refresh: [], handoff: [entry: FocusEntry] }>()
const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const now = ref(Date.now())
const ranked = computed(() => rankTodayFocus(props.entries, now.value, locale.value === 'zh-CN'))
const rows = computed(() => ranked.value.slice(0, 3).map(entry => ({ ...entry, reason: entry.reasons.join(' · ') })))
const snapshot = computed(() => JSON.stringify([props.entries, props.coverage, new Date(now.value).toDateString(), locale.value]))
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 60_000) })
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <section class="today-focus" :class="{ 'is-wide': wide }" :aria-label="copy('今日重点', 'Today’s focus')">
    <header class="focus-heading">
      <div class="focus-title"><Icon name="sun" /><h2>{{ copy('今日重点', 'Today’s focus') }}</h2><time>{{ new Date(now).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' }) }}</time></div>
    </header>
    <div class="focus-toolbar">
      <span>{{ copy('截止时间与优先级', 'Deadlines & priority') }}</span>
      <div><UiButton variant="ghost" size="icon" :disabled="loading" :aria-label="copy('刷新今日重点', 'Refresh today’s focus')" @click="emit('refresh')"><Icon :name="loading ? 'loading' : 'refresh'" /></UiButton></div>
    </div>
    <ol v-if="rows.length" class="focus-list">
      <li v-for="(row, index) in rows" :key="`${snapshot}:${row.key}`">
        <span class="focus-number">{{ index + 1 }}</span>
        <details class="focus-item">
          <summary :title="row.item.title">
            <span class="focus-item-copy"><strong>{{ row.item.title }}</strong><small><VisualIcon :icon="row.source.icon" :fallback="workItemTypeIcon(row.item)" />{{ row.item.project?.title || row.source.title }}<span v-if="row.item.statusLabel">· {{ row.item.statusLabel }}</span></small></span>
            <Icon name="arrowRight" class="focus-disclosure" />
          </summary>
          <div class="focus-detail"><p>{{ row.reason }}</p><UiButton variant="ghost" size="compact" @click="emit('handoff', row)"><Icon name="copy" />{{ copy('准备交接', 'Prepare handoff') }}</UiButton></div>
        </details>
      </li>
    </ol>
    <p v-else class="focus-empty" role="status">{{ loading ? copy('正在汇总…', 'Reading sources…') : copy('暂无未完成事项。', 'No unfinished work.') }}</p>
    <details class="focus-context">
      <summary><span>{{ ranked.length }} {{ copy('项待办', 'tasks') }} · {{ copy('分析范围', 'Analysis scope') }}</span><Icon name="arrowDown" /></summary>
      <p>{{ coverage }}</p>
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
.focus-disclosure { flex: none; width: 14px; height: 14px; color: var(--muted); }
.focus-item[open] .focus-disclosure { transform: rotate(90deg); }
.focus-detail { padding: 0 0 10px; }
.focus-detail p { margin: 0 0 6px; color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.focus-detail button { padding-left: 0; color: var(--accent); }
.focus-context { border-top: 1px solid var(--border); font-size: 11px; color: var(--muted); line-height: 1.6; }
.focus-context summary { display: flex; align-items: center; justify-content: space-between; min-height: 32px; cursor: pointer; }
.focus-context summary .app-icon { width: 14px; height: 14px; }
.focus-context[open] summary .app-icon { transform: rotate(180deg); }
.focus-context p { margin: 0 0 10px; }
@container focus-overview (min-width: 760px) {
  .focus-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 16px; padding-block: 6px; }
  .focus-list li { min-width: 0; border-bottom: 0; }
  .focus-list li:not(:nth-child(3n+1)) { border-left: 1px solid var(--border); padding-left: 16px; }
  .focus-item summary { min-height: 52px; }
  .focus-item strong { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; white-space: normal; }
  .focus-item[open] strong { display: block; }
}
summary { list-style: none; }
summary::-webkit-details-marker { display: none; }
summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; border-radius: 4px; }
.focus-empty { padding: 12px 0; color: var(--muted); font-size: 12px; }
@media (max-width: 400px) { .today-focus { padding-inline: 12px; } .focus-title time { display: none; } }
</style>
