<script setup lang="ts">
import { computed, ref } from 'vue'
import packageMetadata from '../../../../package.json'

const props = withDefaults(defineProps<{
  locale?: 'en' | 'zh-CN'
}>(), {
  locale: 'en',
})

const repositoryUrl = 'https://github.com/YunYouJun/craft-hub'
const command = 'pnpm dlx craft-hub@next app .'
const copied = ref(false)
const isZh = computed(() => props.locale === 'zh-CN')
const releaseTag = `v${packageMetadata.version}`
const releaseUrl = `${repositoryUrl}/releases/tag/${releaseTag}`
const assetBaseUrl = `${repositoryUrl}/releases/download/${releaseTag}`

const copy = computed(() => isZh.value
  ? {
      title: '下载 Craft Hub',
      description: '在快速、本地优先的桌面工作台中运行你的项目。',
      release: `${releaseTag} · 早期 Alpha`,
      platform: 'macOS',
      platformHint: 'macOS 14 Sonoma 及以上',
      appleSilicon: 'Apple 芯片',
      appleSiliconMeta: '推荐 · Apple M 系列 (arm64)',
      intel: 'Intel Mac',
      intelMeta: '实验性支持 · Intel (x64)',
      download: '下载 DMG',
      releaseNotes: '查看发布说明',
      cliTitle: '更喜欢命令行？',
      copy: '复制',
      copied: '已复制',
      availability: '桌面安装包目前提供 macOS 版本。',
      installation: '安装指南',
      installationDesc: '环境准备与首次启动说明',
      releases: '所有版本',
      releasesDesc: '浏览历史发行包与变更记录',
      issues: '报告问题',
      issuesDesc: '向维护团队提交反馈或缺陷',
    }
  : {
      title: 'Download Craft Hub',
      description: 'Run your projects from a fast, local desktop workbench.',
      release: `${releaseTag} · Early alpha`,
      platform: 'macOS',
      platformHint: 'macOS 14 Sonoma or later',
      appleSilicon: 'Apple silicon',
      appleSiliconMeta: 'Recommended · M-series (arm64)',
      intel: 'Intel Mac',
      intelMeta: 'Experimental · x64',
      download: 'Download DMG',
      releaseNotes: 'View release notes',
      cliTitle: 'Prefer the command line?',
      copy: 'Copy',
      copied: 'Copied',
      availability: 'Desktop builds are currently available for macOS.',
      installation: 'Installation guide',
      installationDesc: 'Setup steps and first-run checks',
      releases: 'All releases',
      releasesDesc: 'Browse installers and tags on GitHub',
      issues: 'Report an issue',
      issuesDesc: 'Share bug reports or UI feedback',
    })

const downloads = computed(() => [
  {
    name: copy.value.appleSilicon,
    meta: copy.value.appleSiliconMeta,
    architecture: 'arm64' as const,
    primary: true,
    href: `${assetBaseUrl}/Craft-Hub-macOS-arm64.dmg`,
  },
  {
    name: copy.value.intel,
    meta: copy.value.intelMeta,
    architecture: 'x64' as const,
    primary: false,
    href: `${assetBaseUrl}/Craft-Hub-macOS-x64.dmg`,
  },
])

const installationLink = computed(() => isZh.value ? '/zh/guide/getting-started' : '/guide/getting-started')

async function copyCommand(): Promise<void> {
  await navigator.clipboard.writeText(command)
  copied.value = true
  window.setTimeout(() => copied.value = false, 1800)
}
</script>

<template>
  <main class="download-page">
    <div class="download-shell">
      <header class="download-intro">
        <span class="download-release-pill">{{ copy.release }}</span>
        <h1>{{ copy.title }}</h1>
        <p>{{ copy.description }}</p>
      </header>

      <section class="download-sheet" aria-labelledby="download-platform-title">
        <header class="download-sheet-header">
          <div class="download-platform">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="13" rx="2.5" />
              <path d="M2 20h20M9 20l1-3h4l1 3" />
            </svg>
            <div>
              <h2 id="download-platform-title">
                {{ copy.platform }}
              </h2>
              <span>{{ copy.platformHint }}</span>
            </div>
          </div>
        </header>

        <div class="download-options">
          <article v-for="item in downloads" :key="item.architecture" class="download-option">
            <span class="architecture-mark" :class="{ 'is-primary': item.primary }" aria-hidden="true">
              <svg v-if="item.architecture === 'arm64'" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2.5" />
                <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
                <path d="M9 3v3m3-3v3m3-3v3M9 18v3m3-3v3m3-3v3M3 9h3m-3 3h3m-3 3h3M18 9h3m-3 3h3m-3 3h3" />
              </svg>
              <svg v-else viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
                <path d="M9.5 3v3m5-3v3M9.5 18v3m5-3v3M3 9.5h3m-3 5h3M18 9.5h3m-3 5h3M9.5 12h5M12 9.5v5" />
              </svg>
            </span>
            <div class="download-option-copy">
              <h3>{{ item.name }}</h3>
              <p>{{ item.meta }}</p>
            </div>
            <a
              class="download-cta"
              :class="item.primary ? 'download-cta-primary' : 'download-cta-secondary'"
              :href="item.href"
              rel="noreferrer"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19h14" />
              </svg>
              {{ copy.download }}
            </a>
          </article>
        </div>

        <a class="release-link" :href="releaseUrl" target="_blank" rel="noreferrer">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <rect x="5" y="3" width="14" height="18" rx="2" />
            <path d="M9 8h6m-6 4h6m-6 4h4" />
          </svg>
          <span>{{ copy.releaseNotes }}</span>
          <svg class="release-chevron" aria-hidden="true" viewBox="0 0 24 24">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </a>
      </section>

      <section class="cli-panel">
        <div class="cli-panel-header">
          <h2>{{ copy.cliTitle }}</h2>
          <p>{{ copy.availability }}</p>
        </div>
        <div class="command-copy">
          <code>$ {{ command }}</code>
          <button type="button" :aria-label="copy.copy" @click="copyCommand">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <rect x="8" y="8" width="12" height="12" rx="2" />
              <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
            </svg>
            {{ copied ? copy.copied : copy.copy }}
          </button>
        </div>
      </section>

      <nav class="download-support" :aria-label="isZh ? '下载支持' : 'Download support'">
        <a :href="installationLink">
          <div class="support-icon">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M3 5h6a4 4 0 0 1 3 1.5A4 4 0 0 1 15 5h6v14h-6a4 4 0 0 0-3 1.5A4 4 0 0 0 9 19H3zM12 6.5v14" />
            </svg>
          </div>
          <div class="support-copy">
            <strong>{{ copy.installation }}</strong>
            <span>{{ copy.installationDesc }}</span>
          </div>
          <svg class="support-chevron" aria-hidden="true" viewBox="0 0 24 24">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </a>

        <a :href="`${repositoryUrl}/releases`" target="_blank" rel="noreferrer">
          <div class="support-icon">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5 12 12l8-4.5M12 12v9" />
            </svg>
          </div>
          <div class="support-copy">
            <strong>{{ copy.releases }}</strong>
            <span>{{ copy.releasesDesc }}</span>
          </div>
          <svg class="support-chevron" aria-hidden="true" viewBox="0 0 24 24">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </a>

        <a :href="`${repositoryUrl}/issues`" target="_blank" rel="noreferrer">
          <div class="support-icon">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 3.5C7 3.5 3 7.2 3 11.8c0 2.5 1.2 4.8 3.2 6.3L4.8 21l4.1-1.8c1 .3 2 .4 3.1.4 5 0 9-3.7 9-8.3s-4-7.8-9-7.8Z" />
            </svg>
          </div>
          <div class="support-copy">
            <strong>{{ copy.issues }}</strong>
            <span>{{ copy.issuesDesc }}</span>
          </div>
          <svg class="support-chevron" aria-hidden="true" viewBox="0 0 24 24">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </a>
      </nav>
    </div>
  </main>
</template>

<style scoped>
.download-page {
  min-height: calc(100vh - var(--vp-nav-height));
  color: var(--ch-text);
  background: var(--ch-bg);
}

.download-shell {
  width: min(880px, calc(100% - 48px));
  margin: 0 auto;
  padding: clamp(48px, 7vh, 76px) 0 84px;
}

.download-intro {
  max-width: 620px;
  margin: 0 auto 38px;
  text-align: center;
}

.download-release-pill {
  display: inline-flex;
  align-items: center;
  margin-bottom: 18px;
  border: 1px solid var(--ch-border);
  border-radius: var(--ch-radius-pill);
  background: var(--ch-surface);
  box-shadow: 0 1px 2px rgb(29 29 31 / 4%);
  padding: 5px 13px;
  color: var(--ch-text-secondary);
  font-size: 13px;
  font-weight: 500;
}

.download-intro h1 {
  margin: 0;
  font-size: clamp(38px, 4.8vw, 56px);
  font-weight: 680;
  line-height: 1.06;
  letter-spacing: -0.024em;
}

.download-intro p {
  margin: 16px 0 0;
  color: var(--ch-text-secondary);
  font-size: clamp(17px, 1.5vw, 19px);
  line-height: 1.55;
}

/* Inset Grouped macOS Download Sheet */
.download-sheet {
  overflow: hidden;
  border: 1px solid var(--ch-border);
  border-radius: 18px;
  background: var(--ch-surface);
  box-shadow: var(--ch-shadow-card);
}

.download-sheet-header {
  border-bottom: 1px solid var(--ch-border);
  background: var(--ch-surface-subtle);
  padding: 18px 24px;
}

.download-platform {
  display: flex;
  align-items: center;
  gap: 12px;
}

.download-platform svg {
  width: 24px;
  height: 24px;
  fill: none;
  stroke: var(--ch-brand);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.download-platform h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 640;
  line-height: 1.25;
  letter-spacing: -0.015em;
}

.download-platform span {
  display: block;
  margin-top: 2px;
  color: var(--ch-text-muted);
  font-size: 13px;
}

.download-option {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) auto;
  gap: 18px;
  align-items: center;
  border-bottom: 1px solid var(--ch-border);
  padding: 20px 24px;
}

.architecture-mark {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  border: 1px solid var(--ch-border-strong);
  border-radius: 14px;
  background: var(--ch-surface-subtle);
  color: var(--ch-text-secondary);
}

.architecture-mark svg {
  width: 24px;
  height: 24px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.architecture-mark.is-primary {
  border-color: color-mix(in srgb, var(--ch-brand) 25%, var(--ch-border));
  background: var(--ch-brand-soft);
  color: var(--ch-brand);
}

.download-option-copy h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 620;
  line-height: 1.3;
  letter-spacing: -0.02em;
}

.download-option-copy p {
  margin: 4px 0 0;
  color: var(--ch-text-secondary);
  font-size: 14px;
  line-height: 1.45;
}

.download-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  border: 1px solid transparent;
  border-radius: var(--ch-radius-pill);
  padding: 0 18px;
  font-size: 14px;
  font-weight: 550;
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
  transition:
    background-color var(--ch-duration-fast) var(--ch-ease-standard),
    border-color var(--ch-duration-fast) var(--ch-ease-standard),
    box-shadow var(--ch-duration-fast) var(--ch-ease-standard),
    transform 100ms ease;
}

.download-cta:active {
  transform: scale(0.98);
}

.download-cta-primary {
  color: var(--ch-on-brand);
  background: var(--ch-brand-fill);
  box-shadow: var(--ch-shadow-cta);
}

.download-cta-primary:hover {
  color: var(--ch-on-brand);
  background: var(--ch-brand-fill-hover);
  box-shadow: var(--ch-shadow-cta-hover);
}

.download-cta-secondary {
  border-color: var(--ch-border-strong);
  color: var(--ch-text);
  background: var(--ch-surface);
}

.download-cta-secondary:hover {
  border-color: var(--ch-border-hover);
  background: var(--ch-surface-subtle);
}

.download-cta:focus-visible,
.command-copy button:focus-visible,
.download-support a:focus-visible,
.release-link:focus-visible {
  outline: 3px solid var(--ch-focus-ring);
  outline-offset: 2px;
}

.download-cta svg,
.release-link svg,
.command-copy button svg,
.download-support svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.release-link {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 18px;
  gap: 12px;
  align-items: center;
  min-height: 54px;
  padding: 0 24px;
  color: var(--ch-brand);
  font-size: 14px;
  font-weight: 550;
  text-decoration: none;
  transition: background-color var(--ch-duration-fast) var(--ch-ease-standard), color var(--ch-duration-fast) var(--ch-ease-standard);
}

.release-link:hover {
  color: var(--ch-brand-hover);
  background: var(--ch-surface-subtle);
}

.release-chevron {
  color: var(--ch-text-muted);
}

/* CLI sheet */
.cli-panel {
  margin-top: 20px;
  border: 1px solid var(--ch-border);
  border-radius: var(--ch-radius-card);
  background: var(--ch-surface);
  box-shadow: var(--ch-shadow-card);
  padding: 24px;
}

.cli-panel-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 16px;
}

.cli-panel h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 640;
  letter-spacing: -0.02em;
}

.cli-panel-header p {
  margin: 0;
  color: var(--ch-text-muted);
  font-size: 13px;
}

.command-copy {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  margin-top: 14px;
  border: 1px solid var(--ch-border);
  border-radius: 12px;
  background: var(--ch-code-surface);
  padding: 8px 10px 8px 16px;
}

.command-copy code {
  overflow-x: auto;
  color: var(--ch-text-code);
  background: transparent;
  font-size: 14px;
  white-space: nowrap;
}

.command-copy button {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  min-height: 34px;
  border: 1px solid var(--ch-border-strong);
  border-radius: var(--ch-radius-pill);
  background: var(--ch-surface);
  padding: 0 14px;
  color: var(--ch-text);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color var(--ch-duration-fast) var(--ch-ease-standard), border-color var(--ch-duration-fast) var(--ch-ease-standard);
}

.command-copy button:hover {
  border-color: var(--ch-border-hover);
  background: var(--ch-surface-hover);
}

/* Support cards */
.download-support {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 20px;
}

.download-support a {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 16px;
  gap: 12px;
  align-items: center;
  border: 1px solid var(--ch-border);
  border-radius: var(--ch-radius-card);
  background: var(--ch-surface);
  box-shadow: var(--ch-shadow-card);
  padding: 18px;
  color: var(--ch-text);
  text-decoration: none;
  transition: border-color var(--ch-duration-fast) var(--ch-ease-standard), transform var(--ch-duration-fast) var(--ch-ease-standard);
}

.download-support a:hover {
  border-color: var(--ch-border-hover);
  transform: translateY(-1px);
}

.support-icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 10px;
  background: var(--ch-brand-soft);
  color: var(--ch-brand);
}

.support-copy {
  min-width: 0;
}

.support-copy strong {
  display: block;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}

.support-copy span {
  display: block;
  margin-top: 2px;
  color: var(--ch-text-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.support-chevron {
  color: var(--ch-text-muted);
}

@media (max-width: 760px) {
  .download-shell {
    width: calc(100% - 32px);
    padding: 36px 0 56px;
  }

  .download-sheet-header,
  .download-option,
  .release-link {
    padding-inline: 18px;
  }

  .download-option {
    grid-template-columns: 48px minmax(0, 1fr);
    gap: 14px;
  }

  .architecture-mark {
    width: 48px;
    height: 48px;
  }

  .download-cta {
    grid-column: 1 / -1;
    width: 100%;
  }

  .command-copy {
    grid-template-columns: 1fr;
    padding: 12px;
  }

  .command-copy button {
    justify-content: center;
    width: 100%;
  }

  .download-support {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .download-cta,
  .release-link,
  .command-copy button,
  .download-support a {
    transition: none;
  }
}
</style>
