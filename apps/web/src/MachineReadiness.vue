<script setup lang="ts">
import type { ReadinessItem, ReadinessItemState, ReadinessText } from './machine-readiness'
import { storeToRefs } from 'pinia'
import { computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { Badge } from './components/ui/badge'
import { Button as UiButton } from './components/ui/button'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { machineReadiness } from './machine-readiness'
import { useMachineReadinessStore, useWorkbenchStore } from './store'

const props = defineProps<{ refreshKey?: number }>()
const store = useWorkbenchStore()
const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const text = (value: ReadinessText) => locale.value === 'zh-CN' ? value.zh ?? value.en : value.en
const machine = useMachineReadinessStore()
const { setup, review, setupFailed, reviewFailed, busy } = storeToRefs(machine)
const hosted = computed(() => store.hostEnvironment.kind === 'hosted' || store.localEnvironmentAccess === 'hosted')
const readiness = computed(() => machineReadiness({ setup: setup.value, review: review.value, setupFailed: setupFailed.value, reviewFailed: reviewFailed.value }))
const unconfirmed = computed(() => setupFailed.value || reviewFailed.value)
const observed = computed(() => !!setup.value || !!review.value)
const checkedAt = computed(() => setup.value ? new Date(setup.value.checkedAt).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' }) : '')
const labels: Record<ReadinessItemState, [string, string]> = {
  'ready': ['已就绪', 'Ready'],
  'action-required': ['待操作', 'Action needed'],
  'blocked': ['等待前置步骤', 'Waiting'],
  'missing': ['未检测到', 'Not detected'],
  'review': ['需审阅', 'Review needed'],
  'unknown': ['尚未确认', 'Not confirmed'],
}
const stateLabel = (item: ReadinessItem) => item.confirmed ? copy(...labels[item.state]) : copy('未确认', 'Unconfirmed')
const stateVariant = (item: ReadinessItem) => !item.confirmed ? 'secondary' : item.state === 'ready' ? 'success' : item.state === 'action-required' || item.state === 'missing' ? 'warning' : 'secondary'
const headline = computed(() => {
  const value = readiness.value
  if (value.environmentReady)
    return copy('环境就绪', 'Environment ready')
  if (unconfirmed.value)
    return copy('当前状态未确认', 'Current state not confirmed')
  if (value.hasProfile === false)
    return copy('尚未保存环境方案', 'No environment profile yet')
  return copy(`还差 ${value.total - value.ready} 项`, `${value.total - value.ready} left`)
})
const preview = (items: ReadinessItem[]) => {
  const names = items.slice(0, 3).map(item => text(item.title)).join(copy('、', ', '))
  return items.length > 3 ? copy(`${names} 等 ${items.length} 项`, `${names} and ${items.length - 3} more`) : names
}

// Re-entering the home page shows the last observation at once and only probes again once it is no longer recent.
watch(() => [props.refreshKey, hosted.value] as const, ([refreshKey]) => void machine.refresh({ refreshKey }), { immediate: true })
const recheck = () => void machine.refresh({ force: true, refreshKey: props.refreshKey })
</script>

<template>
  <section class="machine-readiness" :aria-busy="busy" aria-labelledby="machine-readiness-title" data-testid="machine-readiness">
    <header class="readiness-header">
      <div>
        <h2 id="machine-readiness-title">{{ copy('这台电脑的准备情况', 'This machine') }}</h2>
        <p v-if="checkedAt">{{ unconfirmed || busy ? copy(`上次检查 ${checkedAt}`, `Last checked ${checkedAt}`) : copy(`检查于 ${checkedAt}`, `Checked ${checkedAt}`) }}</p>
      </div>
      <UiButton v-if="!hosted" size="compact" :disabled="busy" data-testid="refresh-machine-readiness" @click="recheck"><Icon name="refresh" />{{ busy ? copy('检查中…', 'Checking…') : copy('重新检查', 'Check again') }}</UiButton>
    </header>

    <p v-if="hosted" class="readiness-note" data-testid="readiness-hosted">{{ copy('本机检测需要在这台电脑上打开 Craft Hub。托管页面不会读取访问设备的软件与环境。', 'Machine checks require Craft Hub running on this machine. A hosted page does not inspect the visiting device.') }}</p>
    <p v-else-if="busy && !observed" class="readiness-note" aria-live="polite">{{ copy('正在检查本机工具、环境方案与配置源…', 'Checking tools, environment profile and configuration sources…') }}</p>
    <template v-else-if="observed || unconfirmed">
      <div class="readiness-overview">
        <div class="readiness-summary" role="status" data-testid="readiness-summary">
          <strong class="readiness-headline" :class="{ ready: readiness.environmentReady }">{{ headline }}</strong>
          <span v-if="unconfirmed && readiness.total">{{ copy(`上次 ${readiness.previouslyReady + readiness.ready} / ${readiness.total} 项就绪，当前未确认`, `${readiness.previouslyReady + readiness.ready} / ${readiness.total} ready at the last check; not confirmed now`) }}</span>
          <span v-else-if="readiness.total">{{ copy(`${readiness.ready} / ${readiness.total} 项已就绪`, `${readiness.ready} / ${readiness.total} ready`) }}</span>
        </div>
        <ol v-if="readiness.stages.length" class="readiness-stages" :aria-label="copy('准备阶段', 'Setup stages')">
          <li v-for="stage in readiness.stages" :key="stage.id" :class="{ done: stage.ready === stage.total }" :data-testid="`readiness-stage-${stage.id}`">
            <Icon :name="stage.ready === stage.total ? 'check' : 'pending'" /><span>{{ text(stage.title) }}</span><small>{{ stage.ready }}/{{ stage.total }}</small>
          </li>
        </ol>

        <div v-if="readiness.next" class="readiness-next" data-testid="readiness-next">
          <span class="readiness-label">{{ copy('下一步', 'Next step') }}</span>
          <strong>{{ text(readiness.next.title) }}</strong>
          <p v-if="readiness.next.detail">{{ text(readiness.next.detail) }}</p>
          <UiButton v-if="readiness.next.kind === 'recheck'" variant="primary" size="compact" :disabled="busy" @click="recheck">{{ copy('重新检查', 'Check again') }}</UiButton>
          <RouterLink v-else class="readiness-cta" :to="readiness.next.to">{{ readiness.next.to.path === '/software' ? copy('前往软件中心', 'Open Software center') : readiness.next.to.path === '/environment/setup' ? copy('前往准备引导', 'Open the setup guide') : copy('前往审阅', 'Open review') }}<Icon name="arrowRight" /></RouterLink>
        </div>
        <p v-else-if="readiness.environmentReady" class="readiness-note">{{ copy('方案中的软件与配置均已通过本次检查。', 'Every profile item passed this check.') }}</p>
      </div>

      <div class="readiness-details">
        <section v-if="readiness.blockers.length" class="readiness-block" data-testid="readiness-blockers">
          <h3>{{ copy('卡在哪', 'What is blocking') }}</h3>
          <ul>
            <li v-for="item in readiness.blockers" :key="item.key" :data-testid="`readiness-item-${item.key}`">
              <span>{{ text(item.title) }}</span>
              <span v-for="dependency in item.waitingOn" :key="dependency.en" class="readiness-waiting">{{ copy('等待：', 'Waiting for: ') }}{{ text(dependency) }}</span>
              <Badge v-if="!item.waitingOn.length || !item.confirmed" :variant="stateVariant(item)">{{ stateLabel(item) }}</Badge>
            </li>
          </ul>
        </section>

        <section class="readiness-block" data-testid="readiness-differences">
          <h3>{{ copy('方案与本机差异', 'Profile vs. this machine') }}</h3>
          <p v-if="readiness.hasProfile === false" class="readiness-note">{{ copy('保存环境方案后，这里会列出缺失和需要审阅的软件与配置。', 'Save an environment profile to list missing software and configuration here.') }}</p>
          <p v-else-if="reviewFailed && !review" class="readiness-note">{{ copy('无法读取环境方案，差异未确认。', 'The environment profile could not be read; differences are not confirmed.') }}</p>
          <template v-else-if="review">
            <dl class="readiness-differences">
              <div data-testid="difference-missing"><dt>{{ copy('缺失', 'Missing') }} · {{ readiness.differences.missing.length }}</dt><dd>{{ readiness.differences.missing.length ? preview(readiness.differences.missing) : copy('无', 'None') }}</dd></div>
              <div data-testid="difference-review"><dt>{{ copy('需审阅', 'Review needed') }} · {{ readiness.differences.review.length }}</dt><dd>{{ readiness.differences.review.length ? preview(readiness.differences.review) : copy('无', 'None') }}</dd></div>
              <div data-testid="difference-unconfirmed"><dt>{{ copy('未确认', 'Unconfirmed') }} · {{ readiness.differences.unconfirmed.length }}</dt><dd>{{ readiness.differences.unconfirmed.length ? preview(readiness.differences.unconfirmed) : copy('无', 'None') }}</dd></div>
            </dl>
            <p class="readiness-note">{{ copy('暂不比较版本：环境方案与软件目录目前只记录是否检测到，不记录版本。', 'Versions are not compared yet: the profile and software catalog record detection only, not versions.') }}</p>
          </template>
        </section>
      </div>
    </template>
  </section>
</template>

<style scoped>
.machine-readiness { display: grid; gap: 12px; min-width: 0; border: 1px solid var(--border); border-radius: var(--panel-radius); padding: 14px 16px; background: var(--surface); }
.readiness-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.readiness-header h2 { margin: 0; font-size: var(--font-size-subheading); font-weight: 600; line-height: 22px; }
.readiness-header p { margin: 2px 0 0; color: var(--muted); font-size: var(--font-size-caption); line-height: 16px; }
.readiness-header :deep(.app-icon) { width: 14px; height: 14px; }
.readiness-overview { display: grid; gap: 12px; min-width: 0; }
.readiness-summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.readiness-headline { font-size: var(--font-size-emphasis); font-weight: 600; line-height: var(--line-height-emphasis); }
.readiness-headline.ready { color: var(--success); }
.readiness-summary > span { color: var(--muted); font-size: var(--font-size-control); }
.readiness-stages { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.readiness-stages li { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 6px 0; color: var(--text); font-size: var(--font-size-caption); }
.readiness-stages li + li { border-top: 1px solid var(--border); }
.readiness-stages li small { margin-left: auto; color: var(--muted); font-size: inherit; font-variant-numeric: tabular-nums; }
.readiness-stages li :deep(.app-icon) { flex: none; width: 13px; height: 13px; color: var(--muted); }
.readiness-stages li.done :deep(.app-icon) { color: var(--success); }
.readiness-next { display: grid; justify-items: start; gap: 4px; border-top: 1px solid var(--border); padding: 12px 0 0; }
.readiness-label { color: var(--muted); font-size: var(--font-size-caption); font-weight: 500; }
.readiness-next strong { font-size: var(--font-size-emphasis); font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
.readiness-next p { display: -webkit-box; margin: 0; overflow: hidden; color: var(--muted); font-size: var(--font-size-caption); line-height: 1.6; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.readiness-cta { display: inline-flex; align-items: center; gap: 5px; min-height: 30px; margin-top: 4px; color: var(--accent); font-size: var(--font-size-control); font-weight: 500; text-decoration: none; }
.readiness-cta:hover { text-decoration: underline; }
.readiness-cta :deep(.app-icon) { width: 13px; height: 13px; }
.readiness-cta:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.readiness-details { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 12px 24px; min-width: 0; }
.readiness-block { min-width: 0; }
.readiness-block h3 { margin: 0 0 4px; color: var(--muted); font-size: var(--font-size-caption); font-weight: 600; line-height: 18px; }
.readiness-block ul { margin: 0; padding: 0; list-style: none; }
.readiness-block li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 6px 0; border-top: 1px solid var(--border); font-size: var(--font-size-control); }
.readiness-block li > span:first-child { flex: 1 1 140px; min-width: 0; overflow-wrap: anywhere; }
.readiness-waiting { border-radius: 4px; padding: 1px 6px; background: var(--surface-hover); color: var(--muted); font-size: var(--font-size-caption); line-height: 18px; }
.readiness-differences { display: grid; gap: 0; margin: 0; }
.readiness-differences > div { display: grid; grid-template-columns: minmax(84px, auto) 1fr; gap: 8px; padding: 6px 0; border-top: 1px solid var(--border); font-size: var(--font-size-control); }
.readiness-differences dt { color: var(--text); font-weight: 500; }
.readiness-differences dd { margin: 0; min-width: 0; color: var(--muted); overflow-wrap: anywhere; }
.readiness-note { margin: 0; color: var(--muted); font-size: var(--font-size-caption); line-height: 1.6; overflow-wrap: anywhere; }
@media (min-width: 1100px) { .machine-readiness:has(.readiness-overview) { grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); column-gap: 28px; } .readiness-header, .readiness-header ~ .readiness-note { grid-column: 1 / -1; } .readiness-details { grid-template-columns: 1fr; align-content: start; } }
</style>
