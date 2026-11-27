<script setup lang="ts">
import { computed } from 'vue'
import WorkbenchWindowFrame from './WorkbenchWindowFrame.vue'

const props = withDefaults(defineProps<{
  locale?: 'en' | 'zh-CN'
}>(), {
  locale: 'en',
})

const isZh = computed(() => props.locale === 'zh-CN')
const copy = computed(() => isZh.value
  ? {
      eyebrow: 'macOS · 本地优先开发工作台',
      title: '让每个项目\n随时可用',
      description: '跨本地仓库发现快捷命令与 Agent Skills，预览每一次操作，并在明确的信任边界内执行。',
      download: '下载 macOS 版',
      guide: '阅读指南',
      releaseNote: 'Apple 芯片与 Intel 构建 · 早期 Alpha',
      screenshotAlt: 'Craft Hub 工作台界面：项目管理、Project Palette 命令面板与信任边界控制',
      proofs: [
        { title: '发现', description: '在本地项目间快速查找常用命令与 Agent Skills，无需记忆路径。', icon: 'search' },
        { title: '审阅', description: '运行前预览每一项命令定义、工作目录与参数表单，细节清晰可控。', icon: 'review' },
        { title: '安全运行', description: '新项目默认隔离，仅在你明确授权的信任边界内执行脚本或任务。', icon: 'shield' },
      ],
    }
  : {
      eyebrow: 'macOS · Local-first Workbench',
      title: 'Your projects,\nready to run',
      description: 'Discover commands and agent skills across local repositories, preview every action, and run behind an explicit trust boundary.',
      download: 'Download for macOS',
      guide: 'Read the guide',
      releaseNote: 'Apple silicon and Intel builds · Early alpha',
      screenshotAlt: 'Craft Hub desktop workbench showing project navigation, Project Palette, and an explicit trust boundary',
      proofs: [
        { title: 'Discover', description: 'Find commands and agent skills across every local repository in one palette.', icon: 'search' },
        { title: 'Review', description: 'Inspect the exact command, working directory, and inputs before execution.', icon: 'review' },
        { title: 'Run safely', description: 'Execute strictly behind an explicit per-project trust boundary you control.', icon: 'shield' },
      ],
    })

const downloadLink = computed(() => isZh.value ? '/zh/download' : '/download')
const guideLink = computed(() => isZh.value ? '/zh/guide/getting-started' : '/guide/getting-started')
</script>

<template>
  <main class="craft-home">
    <section class="craft-hero">
      <div class="craft-shell">
        <header class="craft-hero-copy">
          <p class="craft-eyebrow">
            <span class="craft-eyebrow-dot" aria-hidden="true" />
            {{ copy.eyebrow }}
          </p>
          <h1>
            <template v-for="(line, index) in copy.title.split('\n')" :key="line">
              <br v-if="index">
              {{ line }}
            </template>
          </h1>
          <p class="craft-hero-description">
            {{ copy.description }}
          </p>
          <div class="craft-actions">
            <a class="craft-button craft-button-primary" :href="downloadLink">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19h14" />
              </svg>
              {{ copy.download }}
            </a>
            <a class="craft-button craft-button-secondary" :href="guideLink">
              {{ copy.guide }}
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M5 12h14m-5-5 5 5-5 5" />
              </svg>
            </a>
          </div>
          <p class="craft-release-note">
            {{ copy.releaseNote }}
          </p>
        </header>

        <WorkbenchWindowFrame class="craft-hero-window" :alt="copy.screenshotAlt" />
      </div>
    </section>

    <section class="craft-proof" :aria-label="isZh ? 'Craft Hub 核心工作流' : 'Craft Hub workflow'">
      <div class="craft-shell">
        <div class="craft-proof-grid">
          <article v-for="proof in copy.proofs" :key="proof.title" class="craft-proof-card">
            <span class="craft-proof-icon" aria-hidden="true">
              <svg v-if="proof.icon === 'search'" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
              <svg v-else-if="proof.icon === 'review'" viewBox="0 0 24 24">
                <path d="M4 7h2m4 0h10M4 12h2m4 0h10M4 17h2m4 0h10" />
              </svg>
              <svg v-else viewBox="0 0 24 24">
                <path d="M12 3 20 6v6c0 5-3.3 8.8-8 10.5C7.3 20.8 4 17 4 12V6l8-3Z" />
                <path d="m8.8 12 2.2 2.2 4.4-4.4" />
              </svg>
            </span>
            <h2>{{ proof.title }}</h2>
            <p>{{ proof.description }}</p>
          </article>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.craft-home {
  color: var(--ch-text);
  background: var(--ch-bg);
}

.craft-shell {
  width: min(1120px, calc(100% - 48px));
  margin: 0 auto;
}

.craft-hero {
  padding: clamp(56px, 8vh, 88px) 0 40px;
}

.craft-hero-copy {
  max-width: 760px;
  margin: 0 auto;
  text-align: center;
}

.craft-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 22px;
  border: 1px solid var(--ch-border);
  border-radius: var(--ch-radius-pill);
  background: var(--ch-surface);
  box-shadow: 0 1px 2px rgb(29 29 31 / 4%);
  padding: 5px 13px;
  color: var(--ch-text-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
}

.craft-eyebrow-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ch-success-dot);
}

.craft-hero-copy h1 {
  margin: 0;
  font-size: clamp(44px, 5.4vw, 66px);
  font-weight: 680;
  line-height: 1.05;
  letter-spacing: -0.024em;
}

.craft-hero-description {
  max-width: 620px;
  margin: 20px auto 0;
  color: var(--ch-text-secondary);
  font-size: clamp(17px, 1.5vw, 20px);
  line-height: 1.55;
}

.craft-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 28px;
}

.craft-button {
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
    background-color var(--ch-duration-fast) var(--ch-ease-standard),
    border-color var(--ch-duration-fast) var(--ch-ease-standard),
    box-shadow var(--ch-duration-fast) var(--ch-ease-standard),
    color var(--ch-duration-fast) var(--ch-ease-standard),
    transform 100ms ease;
}

.craft-button:active {
  transform: scale(0.98);
}

.craft-button:focus-visible {
  outline: 3px solid var(--ch-focus-ring);
  outline-offset: 2px;
}

.craft-button svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.craft-button-primary {
  color: var(--ch-on-brand);
  background: var(--ch-brand-fill);
  box-shadow: var(--ch-shadow-cta);
}

.craft-button-primary:hover {
  color: var(--ch-on-brand);
  background: var(--ch-brand-fill-hover);
  box-shadow: var(--ch-shadow-cta-hover);
}

.craft-button-secondary {
  border-color: var(--ch-border-strong);
  color: var(--ch-text);
  background: var(--ch-surface);
  box-shadow: var(--ch-shadow-card);
}

.craft-button-secondary:hover {
  border-color: var(--ch-border-hover);
  background: var(--ch-surface-subtle);
}

.craft-release-note {
  margin: 16px 0 0;
  color: var(--ch-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

/* macOS window showcase spacing */
.craft-hero-window {
  margin-top: 44px;
}

/* Craft paper workflow proof cards */
.craft-proof {
  padding: 20px 0 88px;
}

.craft-proof-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.craft-proof-card {
  border: 1px solid var(--ch-border);
  border-radius: var(--ch-radius-card);
  background: var(--ch-surface);
  box-shadow: var(--ch-shadow-card);
  padding: 24px;
}

.craft-proof-icon {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 11px;
  background: var(--ch-brand-soft);
  color: var(--ch-brand);
}

.craft-proof-icon svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.85;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.craft-proof-card h2 {
  margin: 16px 0 0;
  font-size: 18px;
  font-weight: 640;
  line-height: 1.25;
  letter-spacing: -0.018em;
}

.craft-proof-card p {
  margin: 8px 0 0;
  color: var(--ch-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

@media (max-width: 900px) {
  .craft-proof-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .craft-shell {
    width: calc(100% - 32px);
  }

  .craft-hero {
    padding: 40px 0 28px;
  }

  .craft-hero-copy h1 {
    font-size: clamp(36px, 10.5vw, 48px);
  }

  .craft-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .craft-hero-window {
    margin-top: 32px;
  }

  .craft-proof {
    padding: 12px 0 56px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .craft-button {
    transition: none;
  }
}
</style>
