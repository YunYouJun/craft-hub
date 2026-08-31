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
      appleSilicon: 'Apple 芯片',
      appleSiliconMeta: '推荐 · arm64',
      intel: 'Intel Mac',
      intelMeta: '实验性支持 · x64',
      download: '下载 DMG',
      releaseNotes: '查看发布说明',
      cliTitle: '更喜欢命令行？',
      copy: '复制',
      copied: '已复制',
      availability: '桌面构建目前仅提供 macOS 版本。',
      installation: '安装指南',
      releases: '所有版本',
      issues: '报告问题',
    }
  : {
      title: 'Download Craft Hub',
      description: 'Run your projects from a fast, local desktop workbench.',
      release: `${releaseTag} · Early alpha`,
      platform: 'macOS',
      appleSilicon: 'Apple silicon',
      appleSiliconMeta: 'Recommended · arm64',
      intel: 'Intel Mac',
      intelMeta: 'Experimental · x64',
      download: 'Download DMG',
      releaseNotes: 'View release notes',
      cliTitle: 'Prefer the command line?',
      copy: 'Copy',
      copied: 'Copied',
      availability: 'Desktop builds are currently available for macOS.',
      installation: 'Installation guide',
      releases: 'All releases',
      issues: 'Report an issue',
    })

const downloads = computed(() => [
  {
    name: copy.value.appleSilicon,
    meta: copy.value.appleSiliconMeta,
    architecture: 'M',
    href: `${assetBaseUrl}/Craft-Hub-macOS-arm64.dmg`,
  },
  {
    name: copy.value.intel,
    meta: copy.value.intelMeta,
    architecture: 'x64',
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
    <div class="download-grid" aria-hidden="true" />
    <div class="download-shell">
      <section class="download-hero">
        <header class="download-intro" :class="{ 'is-zh': isZh }">
          <h1>{{ copy.title }}</h1>
          <p>{{ copy.description }}</p>
          <span>{{ copy.release }}</span>
        </header>

        <section class="download-surface" aria-labelledby="download-platform-title">
          <span class="download-beam" aria-hidden="true" />
          <header>
            <svg aria-hidden="true" viewBox="0 0 32 32">
              <rect x="4" y="5" width="24" height="18" rx="3" />
              <path d="M1.5 26h29M11 26l1.5-3h7L21 26" />
            </svg>
            <h2 id="download-platform-title">
              {{ copy.platform }}
            </h2>
          </header>

          <div class="download-options">
            <article v-for="item in downloads" :key="item.architecture" class="download-option">
              <span class="architecture-mark" aria-hidden="true">{{ item.architecture }}</span>
              <div>
                <h3>{{ item.name }}</h3>
                <p>{{ item.meta }}</p>
              </div>
              <a :href="item.href" rel="noreferrer">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M12 3v12m-5-5 5 5 5-5M5 20h14" />
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
            {{ copy.releaseNotes }}
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m9 5 7 7-7 7" />
            </svg>
          </a>
        </section>
      </section>

      <section class="cli-panel">
        <div>
          <h2>{{ copy.cliTitle }}</h2>
          <div class="command-copy">
            <code>{{ command }}</code>
            <button type="button" :aria-label="copy.copy" @click="copyCommand">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <rect x="8" y="8" width="12" height="12" rx="2" />
                <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
              </svg>
              {{ copied ? copy.copied : copy.copy }}
            </button>
          </div>
          <p>{{ copy.availability }}</p>
        </div>
        <svg class="cli-illustration" aria-hidden="true" viewBox="0 0 360 190">
          <rect x="24" y="32" width="136" height="98" rx="9" />
          <path d="M24 53h136M39 44h1m10 0h1m10 0h1M48 80l9 7-9 7m22 0h22" />
          <path d="M126 112h92m-20-17 20 17-20 17" stroke-dasharray="5 7" />
          <rect x="218" y="24" width="112" height="130" rx="11" />
          <path d="M236 43h76v84h-76zm-13 111h102l15 12H208z" />
          <circle cx="274" cy="86" r="21" />
          <path d="M274 73v23m-8-8 8 8 8-8" />
        </svg>
      </section>

      <nav class="download-support" :aria-label="isZh ? '下载支持' : 'Download support'">
        <a :href="installationLink">
          <svg aria-hidden="true" viewBox="0 0 28 28">
            <path d="M3 5h7a5 5 0 0 1 4 2 5 5 0 0 1 4-2h7v18h-7a5 5 0 0 0-4 2 5 5 0 0 0-4-2H3zM14 7v18" />
          </svg>
          {{ copy.installation }}
          <span aria-hidden="true">→</span>
        </a>
        <a :href="`${repositoryUrl}/releases`" target="_blank" rel="noreferrer">
          <svg aria-hidden="true" viewBox="0 0 28 28">
            <path d="m14 2 10 6v12l-10 6L4 20V8zM4 8l10 6 10-6m-10 6v12" />
          </svg>
          {{ copy.releases }}
          <span aria-hidden="true">→</span>
        </a>
        <a :href="`${repositoryUrl}/issues`" target="_blank" rel="noreferrer">
          <svg aria-hidden="true" viewBox="0 0 28 28">
            <path d="M14 3C7.9 3 3 7.4 3 13c0 3 1.4 5.7 3.7 7.5L5 25l5-2.3c1.3.3 2.6.5 4 .5 6.1 0 11-4.4 11-10S20.1 3 14 3Z" />
            <path d="M9 13h.1m4.9 0h.1m4.9 0h.1" />
          </svg>
          {{ copy.issues }}
          <span aria-hidden="true">→</span>
        </a>
      </nav>
    </div>
  </main>
</template>

<style scoped>
.download-page {
  --download-accent: #1558e8;
  --download-accent-hover: #0d49c8;
  --download-border: #dce3ee;
  --download-muted: #56647c;
  position: relative;
  overflow: hidden;
  min-height: calc(100vh - var(--vp-nav-height));
  color: #090d16;
  background: #fff;
}

.download-grid {
  position: absolute;
  pointer-events: none;
  background-image: linear-gradient(rgb(21 88 232 / 8%) 1px, transparent 1px), linear-gradient(90deg, rgb(21 88 232 / 8%) 1px, transparent 1px);
  background-size: 72px 72px;
  inset: 0 0 auto 34%;
  height: 620px;
  mask-image: radial-gradient(ellipse at 62% 28%, #000 0%, transparent 72%);
}

.download-shell {
  position: relative;
  width: min(1416px, calc(100% - 72px));
  margin: 0 auto;
  padding: 54px 0 42px;
}

.download-hero {
  display: grid;
  grid-template-columns: minmax(360px, .72fr) minmax(680px, 1.45fr);
  gap: clamp(52px, 6vw, 96px);
  align-items: center;
}

.download-intro h1 {
  max-width: 500px;
  margin: 0;
  font-size: clamp(60px, 4.7vw, 72px);
  font-weight: 760;
  line-height: .98;
  letter-spacing: -.06em;
}

.download-intro.is-zh h1 {
  white-space: nowrap;
}

.download-intro p {
  max-width: 470px;
  margin: 30px 0 0;
  color: var(--download-muted);
  font-size: clamp(19px, 1.6vw, 23px);
  line-height: 1.55;
}

.download-intro span {
  display: block;
  margin-top: 26px;
  color: #647189;
  font-size: 16px;
}

.download-surface {
  position: relative;
  z-index: 1;
  border: 1px solid #aebfdb;
  border-radius: 15px;
  background: #fff;
  box-shadow: 0 24px 70px rgb(31 50 86 / 12%);
}

.download-beam {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  border: 1px solid transparent;
  border-radius: inherit;
  background: linear-gradient(105deg, transparent 28%, rgb(21 88 232 / 76%) 45%, rgb(80 200 255 / 88%) 50%, transparent 66%) border-box;
  background-size: 280% 100%;
  inset: -1px;
  mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  animation: download-beam 6s linear infinite;
}

.download-surface > header {
  display: flex;
  gap: 15px;
  align-items: center;
  padding: 34px 44px 18px;
}

.download-surface > header svg {
  width: 32px;
  height: 32px;
  fill: none;
  stroke: var(--download-accent);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.download-surface h2 {
  margin: 0;
  font-size: 28px;
  line-height: 1.2;
  letter-spacing: -.035em;
}

.download-options {
  padding: 0 34px;
}

.download-option {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr) auto;
  gap: 24px;
  align-items: center;
  min-height: 132px;
  border-bottom: 1px solid var(--download-border);
  padding: 24px 10px;
}

.architecture-mark {
  display: grid;
  width: 62px;
  height: 62px;
  place-items: center;
  border: 1px solid #b9c9e4;
  border-radius: 12px;
  color: var(--download-accent);
  background: #f8faff;
  box-shadow: inset 0 0 0 4px #fff, inset 0 0 0 5px rgb(21 88 232 / 24%);
  font-size: 18px;
  font-weight: 760;
  letter-spacing: -.04em;
}

.download-option h3 {
  margin: 0;
  font-size: 20px;
  line-height: 1.3;
}

.download-option p {
  margin: 6px 0 0;
  color: var(--download-muted);
  font-size: 15px;
  line-height: 1.4;
}

.download-option > a {
  display: inline-flex;
  gap: 10px;
  align-items: center;
  justify-content: center;
  min-height: 54px;
  border-radius: 8px;
  padding: 0 21px;
  color: #fff;
  background: var(--download-accent);
  box-shadow: 0 8px 22px rgb(21 88 232 / 17%);
  font-size: 15px;
  font-weight: 650;
  text-decoration: none;
  transition: background-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.download-option > a:hover {
  color: #fff;
  background: var(--download-accent-hover);
  box-shadow: 0 12px 28px rgb(21 88 232 / 24%);
  transform: translateY(-1px);
}

.download-option > a:focus-visible,
.command-copy button:focus-visible,
.download-support a:focus-visible,
.release-link:focus-visible {
  outline: 3px solid rgb(21 88 232 / 24%);
  outline-offset: 3px;
}

.download-option > a svg,
.release-link svg,
.command-copy button svg,
.download-support svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.download-option > a svg {
  width: 20px;
  height: 20px;
}

.release-link {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) 22px;
  gap: 13px;
  align-items: center;
  margin: 0 34px;
  min-height: 68px;
  padding: 0 12px;
  color: var(--download-accent);
  font-size: 15px;
  font-weight: 650;
  text-decoration: none;
}

.release-link:hover {
  color: var(--download-accent-hover);
}

.release-link svg {
  width: 22px;
  height: 22px;
}

.cli-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 64px;
  align-items: center;
  margin-top: 58px;
  border: 1px solid var(--download-border);
  border-radius: 14px;
  padding: 32px 40px;
  background: #fff;
}

.cli-panel h2 {
  margin: 0;
  font-size: 24px;
  line-height: 1.3;
  letter-spacing: -.03em;
}

.command-copy {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  max-width: 650px;
  margin-top: 18px;
  border: 1px solid #ccd6e5;
  border-radius: 8px;
  padding: 9px 10px 9px 16px;
  background: #fbfcff;
}

.command-copy code {
  overflow-x: auto;
  color: #131b2b;
  background: transparent;
  font-size: 15px;
  white-space: nowrap;
}

.command-copy button {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  min-height: 38px;
  border: 1px solid #b9c8e0;
  border-radius: 7px;
  padding: 0 12px;
  color: var(--download-accent);
  background: #fff;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}

.command-copy button:hover {
  border-color: #92a9cc;
  background: #f4f7ff;
}

.command-copy button svg {
  width: 17px;
  height: 17px;
}

.cli-panel p {
  margin: 15px 0 0;
  color: var(--download-muted);
  font-size: 14px;
}

.cli-illustration {
  width: 100%;
  max-height: 170px;
  fill: none;
  stroke: rgb(21 88 232 / 33%);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.download-support {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 28px;
}

.download-support a {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  min-height: 82px;
  padding: 0 28px;
  color: var(--download-accent);
  font-size: 15px;
  font-weight: 650;
  text-decoration: none;
}

.download-support a + a {
  border-left: 1px solid var(--download-border);
}

.download-support a:hover {
  color: var(--download-accent-hover);
  background: #f8faff;
}

.download-support svg {
  width: 30px;
  height: 30px;
}

.download-support span {
  font-size: 20px;
}

.dark .download-page {
  --download-accent: #79a2ff;
  --download-accent-hover: #9ab8ff;
  --download-border: #2d3543;
  --download-muted: #a9b2c2;
  color: #f5f7fb;
  background: #0d1016;
}

.dark .download-surface,
.dark .cli-panel {
  border-color: #3e4859;
  background: #121720;
}

.dark .architecture-mark,
.dark .command-copy,
.dark .command-copy button {
  border-color: #3e4859;
  color: #a9c0ff;
  background: #171d27;
  box-shadow: none;
}

.dark .command-copy code {
  color: #edf2fb;
}

.dark .command-copy button:hover,
.dark .download-support a:hover {
  background: #1c2533;
}

@keyframes download-beam {
  from { background-position: 140% 0; }
  to { background-position: -140% 0; }
}

@media (max-width: 1120px) {
  .download-shell {
    width: min(100% - 48px, 980px);
  }

  .download-hero {
    grid-template-columns: 1fr;
  }

  .download-intro {
    max-width: 720px;
  }
}

@media (max-width: 760px) {
  .download-shell {
    width: calc(100% - 32px);
    padding-top: 46px;
  }

  .download-hero {
    gap: 42px;
  }

  .download-intro h1 {
    font-size: clamp(50px, 14vw, 66px);
  }

  .download-surface > header {
    padding: 26px 24px 14px;
  }

  .download-options {
    padding: 0 18px;
  }

  .download-option {
    grid-template-columns: 58px minmax(0, 1fr);
    gap: 16px;
    padding: 22px 6px 26px;
  }

  .architecture-mark {
    width: 54px;
    height: 54px;
  }

  .download-option > a {
    grid-column: 1 / -1;
    width: 100%;
  }

  .release-link {
    margin: 0 18px;
  }

  .cli-panel {
    grid-template-columns: 1fr;
    gap: 28px;
    margin-top: 38px;
    padding: 28px 22px;
  }

  .command-copy {
    grid-template-columns: 1fr;
  }

  .command-copy button {
    justify-content: center;
  }

  .cli-illustration {
    max-height: 140px;
  }

  .download-support {
    grid-template-columns: 1fr;
  }

  .download-support a + a {
    border-top: 1px solid var(--download-border);
    border-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .download-beam {
    animation: none;
    background-position: 50% 0;
  }

  .download-option > a {
    transition: none;
  }
}
</style>
