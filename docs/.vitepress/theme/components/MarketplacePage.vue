<script setup lang="ts">
import { computed } from 'vue'
import codexPluginManifest from '../../../../plugins/craft-hub/.codex-plugin/plugin.json'
import codexPluginIcon from '../../../../plugins/craft-hub/assets/icon.svg'
import mcpPackage from '../../../../packages/craft-hub-mcp/package.json'
import craftHubIcon from '../../../public/favicon.svg'
import WorkbenchWindowFrame from './WorkbenchWindowFrame.vue'

const props = withDefaults(defineProps<{
  locale?: 'en' | 'zh-CN'
}>(), {
  locale: 'en',
})

const repositoryUrl = 'https://github.com/YunYouJun/craft-hub'
const isZh = computed(() => props.locale === 'zh-CN')

const copy = computed(() => isZh.value
  ? {
      title: 'Craft Hub 生态，一站汇集。',
      description: '发现连接项目、命令与 Agent Skills 的可信集成。',
      guide: '查看指南',
      github: '前往 GitHub',
      screenshotAlt: 'Craft Hub 工作台界面：项目管理、Project Palette 命令面板与信任边界控制',
      showcaseTitle: '插件橱窗',
      showcaseDescription: '已经随 Craft Hub 发布的真实集成。',
      earlyAlpha: '早期 alpha 阶段尚未提供中央公共 Plugin Catalog。',
      interactiveTitle: '在工作台中使用插件市场',
      interactiveDescription: '运行 Craft Hub 后，从活动栏打开插件市场，以浏览本机配置的市场源、检查权限并安装插件。',
      interactiveAction: '阅读市场指南',
    }
  : {
      title: 'The Craft Hub ecosystem, in one place.',
      description: 'Discover trusted integrations for projects, commands, and agent skills.',
      guide: 'Browse the guide',
      github: 'View on GitHub',
      screenshotAlt: 'Craft Hub desktop workbench showing project navigation, Project Palette, and an explicit trust boundary',
      showcaseTitle: 'Plugin showcase',
      showcaseDescription: 'Real integrations already shipped with Craft Hub.',
      earlyAlpha: 'No central public Plugin Catalog is shipped during the early alpha.',
      interactiveTitle: 'Use the Marketplace in the workbench',
      interactiveDescription: 'Run Craft Hub and open Marketplace from the activity rail to browse configured sources, inspect permissions, and install plugins.',
      interactiveAction: 'Read the Marketplace guide',
    })

const guideLink = computed(() => isZh.value ? '/zh/guide/plugin-marketplace' : '/guide/plugin-marketplace')

function formatShortVersion(raw: string): string {
  const clean = raw.split('+')[0] ?? raw
  return `v${clean}`
}

const showcaseItems = computed(() => isZh.value
  ? [
      {
        name: 'Craft Hub for Codex',
        type: 'Codex Plugin',
        version: formatShortVersion(codexPluginManifest.version),
        fullVersion: `v${codexPluginManifest.version}`,
        category: '生产力',
        description: '管理项目，并在授权执行前预览命令。',
        action: '查看插件',
        href: `${repositoryUrl}/tree/main/plugins/craft-hub`,
        icon: codexPluginIcon,
        iconAlt: 'Craft Hub for Codex',
        external: true,
      },
      {
        name: 'Craft Hub MCP',
        type: 'MCP Adapter',
        version: formatShortVersion(mcpPackage.version),
        fullVersion: `v${mcpPackage.version}`,
        category: '开发者工具',
        description: '将 Agent 客户端连接到 Craft Hub 运行时。',
        action: '查看源码',
        href: `${repositoryUrl}/tree/main/packages/craft-hub-mcp`,
        icon: craftHubIcon,
        iconAlt: 'Craft Hub',
        external: true,
      },
      {
        name: 'Plugin Catalog v1',
        type: 'Developer Contract',
        version: '开始构建',
        fullVersion: '',
        category: '',
        description: '使用明确的权限声明发布可验证的声明式插件。',
        action: '查看规范',
        href: guideLink.value,
        icon: '',
        iconAlt: '',
        external: false,
      },
    ]
  : [
      {
        name: 'Craft Hub for Codex',
        type: 'Codex Plugin',
        version: formatShortVersion(codexPluginManifest.version),
        fullVersion: `v${codexPluginManifest.version}`,
        category: 'Productivity',
        description: 'Organize projects and preview authorized commands.',
        action: 'View plugin',
        href: `${repositoryUrl}/tree/main/plugins/craft-hub`,
        icon: codexPluginIcon,
        iconAlt: 'Craft Hub for Codex',
        external: true,
      },
      {
        name: 'Craft Hub MCP',
        type: 'MCP Adapter',
        version: formatShortVersion(mcpPackage.version),
        fullVersion: `v${mcpPackage.version}`,
        category: 'Developer Tools',
        description: 'Connect agent clients to the Craft Hub runtime.',
        action: 'View source',
        href: `${repositoryUrl}/tree/main/packages/craft-hub-mcp`,
        icon: craftHubIcon,
        iconAlt: 'Craft Hub',
        external: true,
      },
      {
        name: 'Plugin Catalog v1',
        type: 'Developer Contract',
        version: 'Build yours',
        fullVersion: '',
        category: '',
        description: 'Publish declarative plugins with explicit permissions.',
        action: 'View specification',
        href: guideLink.value,
        icon: '',
        iconAlt: '',
        external: false,
      },
    ])
</script>

<template>
  <main class="marketplace-landing">
    <section class="marketplace-hero">
      <div class="marketplace-shell marketplace-hero-layout">
        <div class="marketplace-hero-copy">
          <h1>{{ copy.title }}</h1>
          <p>{{ copy.description }}</p>
          <div class="marketplace-actions">
            <a class="marketplace-button marketplace-button-primary" :href="guideLink">
              {{ copy.guide }}
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M4 10h11m-4-4 4 4-4 4" />
              </svg>
            </a>
            <a class="marketplace-button marketplace-button-secondary" :href="repositoryUrl" target="_blank" rel="noreferrer">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path fill="currentColor" d="M12 .9a11.1 11.1 0 0 0-3.5 21.6c.6.1.8-.2.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.8.1-.8 1.2.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 2.9.1 3.2.8.9 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6A11.1 11.1 0 0 0 12 .9Z" />
              </svg>
              {{ copy.github }}
            </a>
          </div>
        </div>

        <WorkbenchWindowFrame :alt="copy.screenshotAlt" compact />
      </div>
    </section>

    <section class="marketplace-showcase">
      <div class="marketplace-shell">
        <header class="marketplace-section-heading">
          <h2>{{ copy.showcaseTitle }}</h2>
          <p>{{ copy.showcaseDescription }}</p>
        </header>

        <div class="marketplace-plugin-list">
          <article
            v-for="item in showcaseItems"
            :key="item.name"
            class="marketplace-plugin"
          >
            <div class="marketplace-plugin-icon" :class="{ 'marketplace-plugin-icon-code': !item.icon }">
              <img v-if="item.icon" :src="item.icon" :alt="item.iconAlt" width="72" height="72">
              <svg v-else aria-hidden="true" viewBox="0 0 32 32">
                <path d="M8 4h11l6 6v18H8z" />
                <path d="M19 4v7h7M14 17l-3 3 3 3m5-6 3 3-3 3m-3-8-1 10" />
              </svg>
            </div>

            <div class="marketplace-plugin-copy">
              <div class="marketplace-plugin-title">
                <h3>{{ item.name }}</h3>
                <span>{{ item.type }}</span>
              </div>
              <div class="marketplace-plugin-meta">
                <span :title="item.fullVersion || undefined">{{ item.version }}</span>
                <span v-if="item.category">{{ item.category }}</span>
              </div>
              <p>{{ item.description }}</p>
            </div>

            <a
              class="marketplace-plugin-action"
              :href="item.href"
              :target="item.external ? '_blank' : undefined"
              :rel="item.external ? 'noreferrer' : undefined"
            >
              {{ item.action }}
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path v-if="item.external" d="M11 4h5v5m0-5-7 7M8 6H5v9h9v-3" />
                <path v-else d="M4 10h11m-4-4 4 4-4 4" />
              </svg>
            </a>
          </article>
        </div>

        <p class="marketplace-alpha-note">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6m0-10v.5" />
          </svg>
          {{ copy.earlyAlpha }}
        </p>
      </div>
    </section>

    <section class="marketplace-interactive">
      <div class="marketplace-shell">
        <div class="marketplace-interactive-card">
          <div>
            <h2>{{ copy.interactiveTitle }}</h2>
            <p>{{ copy.interactiveDescription }}</p>
          </div>
          <a :href="guideLink">
            {{ copy.interactiveAction }}
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <path d="M4 10h11m-4-4 4 4-4 4" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.marketplace-landing {
  color: var(--ch-text);
  background: var(--ch-bg);
}

.marketplace-shell {
  width: min(var(--ch-shell-compact), calc(100% - 48px));
  margin: 0 auto;
}

.marketplace-hero {
  border-bottom: 1px solid var(--ch-border);
  background: var(--ch-bg);
}

.marketplace-hero-layout {
  display: grid;
  grid-template-columns: minmax(380px, .9fr) minmax(520px, 1.35fr);
  gap: clamp(36px, 5vw, 64px);
  align-items: center;
  padding: clamp(52px, 7vh, 78px) 0 clamp(56px, 8vh, 84px);
}

.marketplace-hero-copy h1 {
  margin: 0;
  font-size: clamp(38px, 4.4vw, 56px);
  font-weight: 680;
  line-height: 1.06;
  letter-spacing: -0.024em;
}

.marketplace-hero-copy p {
  max-width: 500px;
  margin: 20px 0 0;
  color: var(--ch-text-secondary);
  font-size: clamp(17px, 1.5vw, 20px);
  line-height: 1.55;
}

.marketplace-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 28px;
}

.marketplace-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 46px;
  border: 1px solid transparent;
  border-radius: var(--ch-radius-pill);
  padding: 0 22px;
  font-size: 15px;
  font-weight: 550;
  line-height: 1;
  text-decoration: none;
  transition:
    border-color var(--ch-duration-fast) var(--ch-ease-standard),
    background-color var(--ch-duration-fast) var(--ch-ease-standard),
    box-shadow var(--ch-duration-fast) var(--ch-ease-standard),
    color var(--ch-duration-fast) var(--ch-ease-standard),
    transform 100ms ease;
}

.marketplace-button:active {
  transform: scale(0.98);
}

.marketplace-button:focus-visible,
.marketplace-plugin-action:focus-visible,
.marketplace-interactive a:focus-visible {
  outline: 3px solid var(--ch-focus-ring);
  outline-offset: 2px;
}

.marketplace-button svg,
.marketplace-plugin-action svg,
.marketplace-interactive a svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.marketplace-button-secondary svg {
  fill: currentColor;
  stroke: none;
}

.marketplace-button-primary {
  color: var(--ch-on-brand);
  background: var(--ch-brand-fill);
  box-shadow: var(--ch-shadow-cta);
}

.marketplace-button-primary:hover {
  color: var(--ch-on-brand);
  background: var(--ch-brand-fill-hover);
  box-shadow: var(--ch-shadow-cta-hover);
}

.marketplace-button-secondary {
  border-color: var(--ch-border-strong);
  color: var(--ch-text);
  background: var(--ch-surface);
  box-shadow: var(--ch-shadow-card);
}

.marketplace-button-secondary:hover {
  border-color: var(--ch-border-hover);
  background: var(--ch-surface-subtle);
}

/* Plugin showcase cards */
.marketplace-showcase {
  padding: 68px 0 76px;
}

.marketplace-section-heading h2 {
  margin: 0;
  font-size: clamp(30px, 3.4vw, 42px);
  font-weight: 680;
  line-height: 1.1;
  letter-spacing: -0.022em;
}

.marketplace-section-heading p {
  margin: 12px 0 0;
  color: var(--ch-text-secondary);
  font-size: 17px;
  line-height: 1.55;
}

.marketplace-plugin-list {
  display: grid;
  gap: 14px;
  margin-top: 34px;
}

.marketplace-plugin {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  gap: 22px;
  align-items: center;
  border: 1px solid var(--ch-border);
  border-radius: var(--ch-radius-card);
  background: var(--ch-surface);
  box-shadow: var(--ch-shadow-card);
  padding: 22px 26px;
  transition: border-color var(--ch-duration-fast) var(--ch-ease-standard);
}

.marketplace-plugin:hover {
  border-color: var(--ch-border-hover);
}

.marketplace-plugin-icon {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  border: 1px solid var(--ch-border);
  border-radius: 15px;
  background: var(--ch-surface-subtle);
  padding: 10px;
}

.marketplace-plugin-icon img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.marketplace-plugin-icon-code {
  border-color: color-mix(in srgb, var(--ch-brand) 20%, var(--ch-border));
  background: var(--ch-brand-soft);
}

.marketplace-plugin-icon-code svg {
  width: 34px;
  height: 34px;
  fill: none;
  stroke: var(--ch-brand);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.marketplace-plugin-copy {
  min-width: 0;
}

.marketplace-plugin-title {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  align-items: baseline;
}

.marketplace-plugin-title h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 640;
  line-height: 1.25;
  letter-spacing: -0.02em;
}

.marketplace-plugin-title span {
  color: var(--ch-text-muted);
  font-size: 13px;
  font-weight: 500;
}

.marketplace-plugin-meta {
  display: flex;
  flex-wrap: wrap;
  margin-top: 6px;
  color: var(--ch-text-muted);
  font-size: 13px;
}

.marketplace-plugin-meta span + span::before {
  margin: 0 8px;
  color: var(--ch-border-strong);
  content: '·';
}

.marketplace-plugin-copy > p {
  margin: 8px 0 0;
  color: var(--ch-text-secondary);
  font-size: 15px;
  line-height: 1.55;
}

.marketplace-plugin-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 4px 2px;
  color: var(--ch-brand);
  font-size: 14px;
  font-weight: 550;
  text-decoration: none;
  white-space: nowrap;
}

.marketplace-plugin-action:hover {
  color: var(--ch-brand-hover);
}

.marketplace-alpha-note {
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 22px 0 0;
  color: var(--ch-text-muted);
  font-size: 14px;
  line-height: 1.5;
}

.marketplace-alpha-note svg {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}

.marketplace-interactive {
  border-top: 1px solid var(--ch-border);
  background: var(--ch-bg-subtle);
  padding: 56px 0 72px;
}

.marketplace-interactive-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 32px;
  align-items: center;
  border: 1px solid var(--ch-border);
  border-radius: 18px;
  background: var(--ch-surface);
  box-shadow: var(--ch-shadow-card);
  padding: 32px 36px;
}

.marketplace-interactive h2 {
  margin: 0;
  font-size: clamp(24px, 2.5vw, 32px);
  font-weight: 660;
  line-height: 1.15;
  letter-spacing: -0.02em;
}

.marketplace-interactive p {
  max-width: 720px;
  margin: 10px 0 0;
  color: var(--ch-text-secondary);
  font-size: 16px;
  line-height: 1.6;
}

.marketplace-interactive a {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 42px;
  border: 1px solid var(--ch-border-strong);
  border-radius: var(--ch-radius-pill);
  background: var(--ch-surface);
  padding: 0 18px;
  color: var(--ch-text);
  font-size: 14px;
  font-weight: 550;
  text-decoration: none;
  white-space: nowrap;
  transition: border-color var(--ch-duration-fast) var(--ch-ease-standard), background-color var(--ch-duration-fast) var(--ch-ease-standard);
}

.marketplace-interactive a:hover {
  border-color: var(--ch-border-hover);
  background: var(--ch-surface-subtle);
}

@media (max-width: 1060px) {
  .marketplace-hero-layout {
    grid-template-columns: 1fr;
  }

  .marketplace-hero-copy {
    max-width: 720px;
  }
}

@media (max-width: 720px) {
  .marketplace-shell {
    width: calc(100% - 32px);
  }

  .marketplace-hero-layout {
    gap: 32px;
    padding: 40px 0 48px;
  }

  .marketplace-showcase {
    padding: 48px 0 56px;
  }

  .marketplace-plugin {
    grid-template-columns: 52px minmax(0, 1fr);
    gap: 14px;
    padding: 18px;
  }

  .marketplace-plugin-icon {
    width: 52px;
    height: 52px;
    border-radius: 13px;
  }

  .marketplace-plugin-action {
    grid-column: 1 / -1;
    justify-self: start;
  }

  .marketplace-interactive {
    padding: 40px 0 52px;
  }

  .marketplace-interactive-card {
    grid-template-columns: 1fr;
    gap: 20px;
    padding: 24px;
  }

  .marketplace-interactive a {
    justify-self: start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .marketplace-button,
  .marketplace-plugin,
  .marketplace-interactive a {
    transition: none;
  }
}
</style>
