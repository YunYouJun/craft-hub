<script setup lang="ts">
import { computed } from 'vue'
import codexPluginManifest from '../../../../plugins/craft-hub/.codex-plugin/plugin.json'
import codexPluginIcon from '../../../../plugins/craft-hub/assets/icon.svg'
import mcpPackage from '../../../../packages/craft-hub-mcp/package.json'
import workbenchConcept from '../../../design/workbench-concept.webp'
import craftHubIcon from '../../../public/favicon.svg'

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
      screenshotAlt: 'Craft Hub 工作台中的项目、命令面板与运行终端',
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
      screenshotAlt: 'Craft Hub workbench showing projects, the command palette, and a running terminal',
      showcaseTitle: 'Plugin showcase',
      showcaseDescription: 'Real integrations already shipped with Craft Hub.',
      earlyAlpha: 'No central public Plugin Catalog is shipped during the early alpha.',
      interactiveTitle: 'Use the Marketplace in the workbench',
      interactiveDescription: 'Run Craft Hub and open Marketplace from the activity rail to browse configured sources, inspect permissions, and install plugins.',
      interactiveAction: 'Read the Marketplace guide',
    })

const guideLink = computed(() => isZh.value ? '/zh/guide/plugin-marketplace' : '/guide/plugin-marketplace')

const showcaseItems = computed(() => isZh.value
  ? [
      {
        name: 'Craft Hub for Codex',
        type: 'Codex Plugin',
        version: `v${codexPluginManifest.version}`,
        category: '生产力',
        description: '管理项目，并在授权执行前预览命令。',
        action: '查看插件',
        href: `${repositoryUrl}/tree/main/plugins/craft-hub`,
        icon: codexPluginIcon,
        iconAlt: 'Craft Hub for Codex',
        featured: true,
        external: true,
      },
      {
        name: 'Craft Hub MCP',
        type: 'MCP Adapter',
        version: `v${mcpPackage.version}`,
        category: '开发者工具',
        description: '将 Agent 客户端连接到 Craft Hub 运行时。',
        action: '查看源码',
        href: `${repositoryUrl}/tree/main/packages/craft-hub-mcp`,
        icon: craftHubIcon,
        iconAlt: 'Craft Hub',
        featured: false,
        external: true,
      },
      {
        name: 'Plugin Catalog v1',
        type: 'Developer Contract',
        version: '开始构建',
        category: '',
        description: '使用明确的权限声明发布可验证的声明式插件。',
        action: '查看规范',
        href: guideLink.value,
        icon: '',
        iconAlt: '',
        featured: false,
        external: false,
      },
    ]
  : [
      {
        name: 'Craft Hub for Codex',
        type: 'Codex Plugin',
        version: `v${codexPluginManifest.version}`,
        category: 'Productivity',
        description: 'Organize projects and preview authorized commands.',
        action: 'View plugin',
        href: `${repositoryUrl}/tree/main/plugins/craft-hub`,
        icon: codexPluginIcon,
        iconAlt: 'Craft Hub for Codex',
        featured: true,
        external: true,
      },
      {
        name: 'Craft Hub MCP',
        type: 'MCP Adapter',
        version: `v${mcpPackage.version}`,
        category: 'Developer Tools',
        description: 'Connect agent clients to the Craft Hub runtime.',
        action: 'View source',
        href: `${repositoryUrl}/tree/main/packages/craft-hub-mcp`,
        icon: craftHubIcon,
        iconAlt: 'Craft Hub',
        featured: false,
        external: true,
      },
      {
        name: 'Plugin Catalog v1',
        type: 'Developer Contract',
        version: 'Build yours',
        category: '',
        description: 'Publish declarative plugins with explicit permissions.',
        action: 'View specification',
        href: guideLink.value,
        icon: '',
        iconAlt: '',
        featured: false,
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
        <figure class="marketplace-hero-media">
          <img
            :src="workbenchConcept"
            :alt="copy.screenshotAlt"
            width="1536"
            height="1024"
            fetchpriority="high"
          >
        </figure>
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
            :class="{ 'marketplace-plugin-featured': item.featured }"
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
                <span>{{ item.version }}</span>
                <span v-if="item.category">{{ item.category }}</span>
              </div>
              <p>{{ item.description }}</p>
            </div>

            <a
              class="marketplace-plugin-action"
              :class="{ 'marketplace-plugin-action-featured': item.featured }"
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
      <div class="marketplace-shell marketplace-interactive-layout">
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
    </section>
  </main>
</template>

<style scoped>
.marketplace-landing {
  --market-accent: #1558e8;
  --market-accent-hover: #0b49c9;
  --market-border: #dfe4ec;
  --market-muted: #59657a;
  overflow: hidden;
  color: #0d1424;
  background: #fff;
}

.marketplace-shell {
  width: min(1320px, calc(100% - 48px));
  margin: 0 auto;
}

.marketplace-hero {
  border-bottom: 1px solid var(--market-border);
  background: #fff;
}

.marketplace-hero-layout {
  display: grid;
  grid-template-columns: minmax(440px, .95fr) minmax(560px, 1.35fr);
  gap: clamp(40px, 5vw, 72px);
  align-items: center;
  min-height: min(700px, calc(100vh - var(--vp-nav-height)));
  padding: 72px 0 80px;
}

.marketplace-hero-copy {
  position: relative;
  z-index: 1;
}

.marketplace-hero-copy h1 {
  max-width: 650px;
  margin: 0;
  font-size: clamp(48px, 5vw, 72px);
  font-weight: 760;
  line-height: .98;
  letter-spacing: -.055em;
}

.marketplace-hero-copy p {
  max-width: 560px;
  margin: 34px 0 0;
  color: var(--market-muted);
  font-size: clamp(19px, 1.8vw, 24px);
  line-height: 1.55;
}

.marketplace-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 38px;
}

.marketplace-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 54px;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 0 22px;
  font-size: 15px;
  font-weight: 650;
  line-height: 1;
  text-decoration: none;
  transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease, transform 160ms ease;
}

.marketplace-button:hover {
  transform: translateY(-1px);
}

.marketplace-button svg,
.marketplace-plugin-action svg,
.marketplace-interactive a svg {
  width: 18px;
  height: 18px;
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
  color: #fff;
  background: var(--market-accent);
}

.marketplace-button-primary:hover {
  color: #fff;
  background: var(--market-accent-hover);
}

.marketplace-button-secondary {
  border-color: var(--market-border);
  color: #121a29;
  background: #fff;
}

.marketplace-button-secondary:hover {
  border-color: #bec8d7;
  color: #121a29;
}

.marketplace-hero-media {
  position: relative;
  margin: 0;
}

.marketplace-hero-media::before {
  position: absolute;
  z-index: -1;
  top: 9%;
  right: -7%;
  bottom: 7%;
  left: 4%;
  border-radius: 28px;
  background: #edf3ff;
  content: '';
  filter: blur(32px);
  opacity: .72;
}

.marketplace-hero-media img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid #d8dee8;
  border-radius: 11px;
  background: #fff;
  box-shadow: 0 24px 70px rgb(31 50 86 / 13%), 0 4px 16px rgb(31 50 86 / 8%);
}

.marketplace-showcase {
  padding: 80px 0 90px;
  background: #fff;
}

.marketplace-section-heading h2,
.marketplace-interactive h2 {
  margin: 0;
  font-size: clamp(38px, 4vw, 60px);
  font-weight: 760;
  line-height: 1.02;
  letter-spacing: -.045em;
}

.marketplace-section-heading p {
  margin: 20px 0 0;
  color: var(--market-muted);
  font-size: 20px;
  line-height: 1.6;
}

.marketplace-plugin-list {
  margin-top: 52px;
}

.marketplace-plugin {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr) auto;
  gap: 30px;
  align-items: center;
  min-height: 172px;
  border-bottom: 1px solid var(--market-border);
  padding: 30px 32px;
  transition: background-color 160ms ease;
}

.marketplace-plugin:hover {
  background: #f8faff;
}

.marketplace-plugin-featured {
  min-height: 206px;
  margin-bottom: 8px;
  border: 1px solid #d4dbe7;
  border-radius: 14px;
}

.marketplace-plugin-featured:hover {
  border-color: #bec9da;
}

.marketplace-plugin-icon {
  display: grid;
  width: 76px;
  height: 76px;
  place-items: center;
}

.marketplace-plugin-featured .marketplace-plugin-icon {
  width: 108px;
  height: 108px;
  justify-self: center;
}

.marketplace-plugin-icon img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.marketplace-plugin-icon-code svg {
  width: 58px;
  height: 58px;
  fill: none;
  stroke: var(--market-accent);
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
  gap: 8px 18px;
  align-items: baseline;
}

.marketplace-plugin-title h3 {
  margin: 0;
  font-size: 26px;
  line-height: 1.2;
  letter-spacing: -.025em;
}

.marketplace-plugin-title span {
  color: var(--market-muted);
  font-size: 15px;
}

.marketplace-plugin-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  margin-top: 13px;
  color: var(--market-muted);
  font-size: 14px;
}

.marketplace-plugin-meta span + span::before {
  margin: 0 12px;
  color: #c0c8d4;
  content: '/';
}

.marketplace-plugin-copy > p {
  margin: 13px 0 0;
  color: var(--market-muted);
  font-size: 17px;
  line-height: 1.55;
}

.marketplace-plugin-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--market-accent);
  font-size: 15px;
  font-weight: 650;
  text-decoration: none;
  white-space: nowrap;
}

.marketplace-plugin-action:hover {
  color: var(--market-accent-hover);
}

.marketplace-plugin-action-featured {
  min-height: 48px;
  border-radius: 8px;
  padding: 0 18px;
  color: #fff;
  background: var(--market-accent);
}

.marketplace-plugin-action-featured:hover {
  color: #fff;
  background: var(--market-accent-hover);
}

.marketplace-alpha-note {
  display: flex;
  gap: 12px;
  align-items: center;
  margin: 30px 0 0;
  color: var(--market-muted);
  font-size: 15px;
  line-height: 1.5;
}

.marketplace-alpha-note svg {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}

.marketplace-interactive {
  border-top: 1px solid var(--market-border);
  background: #f7f9fc;
}

.marketplace-interactive-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 48px;
  align-items: center;
  padding: 72px 0 78px;
}

.marketplace-interactive h2 {
  font-size: clamp(30px, 3vw, 44px);
}

.marketplace-interactive p {
  max-width: 780px;
  margin: 17px 0 0;
  color: var(--market-muted);
  font-size: 17px;
  line-height: 1.65;
}

.marketplace-interactive a {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--market-accent);
  font-size: 16px;
  font-weight: 650;
  text-decoration: none;
  white-space: nowrap;
}

.dark .marketplace-landing {
  --market-accent: #7aa2ff;
  --market-accent-hover: #9ab8ff;
  --market-border: #30394a;
  --market-muted: #a7b0c1;
  color: #f1f4fa;
  background: #10131a;
}

.dark .marketplace-hero,
.dark .marketplace-showcase {
  background: #10131a;
}

.dark .marketplace-button-secondary {
  color: #f1f4fa;
  background: #151a23;
}

.dark .marketplace-button-secondary:hover {
  border-color: #59647a;
  color: #fff;
}

.dark .marketplace-hero-media::before {
  background: #17264c;
  opacity: .52;
}

.dark .marketplace-plugin:hover,
.dark .marketplace-interactive {
  background: #151a23;
}

@media (max-width: 1100px) {
  .marketplace-hero-layout {
    grid-template-columns: 1fr;
    min-height: 0;
    padding-top: 72px;
  }

  .marketplace-hero-copy {
    max-width: 760px;
  }

  .marketplace-hero-media {
    width: min(920px, 100%);
  }
}

@media (max-width: 720px) {
  .marketplace-shell {
    width: min(100% - 32px, 1320px);
  }

  .marketplace-hero-layout {
    gap: 46px;
    padding: 56px 0 64px;
  }

  .marketplace-hero-copy h1 {
    font-size: clamp(42px, 13vw, 60px);
    line-height: 1.02;
  }

  .marketplace-hero-copy p {
    margin-top: 24px;
    font-size: 18px;
  }

  .marketplace-actions {
    margin-top: 30px;
  }

  .marketplace-button {
    min-height: 50px;
    padding: 0 17px;
    font-size: 14px;
  }

  .marketplace-showcase {
    padding: 72px 0 64px;
  }

  .marketplace-section-heading p {
    margin-top: 14px;
    font-size: 17px;
  }

  .marketplace-plugin-list {
    margin-top: 36px;
  }

  .marketplace-plugin,
  .marketplace-plugin-featured {
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 18px;
    min-height: 0;
    margin: 0;
    border-right: 0;
    border-left: 0;
    border-radius: 0;
    padding: 26px 0;
  }

  .marketplace-plugin-featured {
    border-top: 1px solid var(--market-border);
  }

  .marketplace-plugin-icon,
  .marketplace-plugin-featured .marketplace-plugin-icon {
    width: 60px;
    height: 60px;
  }

  .marketplace-plugin-icon-code svg {
    width: 46px;
    height: 46px;
  }

  .marketplace-plugin-title {
    display: block;
  }

  .marketplace-plugin-title h3 {
    font-size: 21px;
  }

  .marketplace-plugin-title span {
    display: block;
    margin-top: 5px;
    font-size: 13px;
  }

  .marketplace-plugin-meta {
    margin-top: 9px;
    font-size: 12px;
  }

  .marketplace-plugin-copy > p {
    margin-top: 10px;
    font-size: 15px;
  }

  .marketplace-plugin-action,
  .marketplace-plugin-action-featured {
    grid-column: 2;
    justify-self: start;
    min-height: 0;
    padding: 0;
    color: var(--market-accent);
    background: transparent;
    font-size: 14px;
  }

  .marketplace-plugin-action-featured:hover {
    color: var(--market-accent-hover);
    background: transparent;
  }

  .marketplace-alpha-note {
    align-items: flex-start;
    font-size: 14px;
  }

  .marketplace-interactive-layout {
    grid-template-columns: 1fr;
    gap: 28px;
    padding: 56px 0 60px;
  }

  .marketplace-interactive p {
    font-size: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .marketplace-button,
  .marketplace-plugin,
  .marketplace-plugin-action {
    transition: none;
  }
}
</style>
