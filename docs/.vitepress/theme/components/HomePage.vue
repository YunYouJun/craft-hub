<script setup lang="ts">
import { computed, ref } from 'vue'
import workbenchConcept from '../../../design/workbench-concept.webp'

const props = withDefaults(defineProps<{
  locale?: 'en' | 'zh-CN'
}>(), {
  locale: 'en',
})

const hero = ref<HTMLElement>()
const isZh = computed(() => props.locale === 'zh-CN')
const copy = computed(() => isZh.value
  ? {
      title: '让每个项目\n随时可用',
      description: '跨本地仓库发现快捷命令与 Agent Skills，预览每一次操作，并在明确的信任边界内执行。',
      download: '下载 macOS 版',
      guide: '阅读指南',
      releaseNote: 'Apple 芯片与 Intel 构建 · 早期 Alpha',
      screenshotAlt: 'Craft Hub 工作台中的项目、命令面板和运行终端',
      proofs: [
        { title: '发现', description: '在本地项目间查找命令与 Skills。', icon: 'search' },
        { title: '审阅', description: '运行前预览每一项操作与参数。', icon: 'review' },
        { title: '安全运行', description: '只在你明确授权的信任边界内执行。', icon: 'shield' },
      ],
    }
  : {
      title: 'Your projects,\nready to run',
      description: 'Discover commands and agent skills across local repositories, preview every action, and run behind an explicit trust boundary.',
      download: 'Download for macOS',
      guide: 'Read the guide',
      releaseNote: 'Apple silicon and Intel builds · Early alpha',
      screenshotAlt: 'Craft Hub workbench showing projects, the command palette, and a running terminal',
      proofs: [
        { title: 'Discover', description: 'Find commands and skills across your local projects.', icon: 'search' },
        { title: 'Review', description: 'Preview every action and argument before you run.', icon: 'review' },
        { title: 'Run safely', description: 'Execute behind an explicit trust boundary you control.', icon: 'shield' },
      ],
    })

const downloadLink = computed(() => isZh.value ? '/zh/download' : '/download')
const guideLink = computed(() => isZh.value ? '/zh/guide/getting-started' : '/guide/getting-started')

function updateGrid(event: PointerEvent): void {
  if (!hero.value)
    return
  const bounds = hero.value.getBoundingClientRect()
  hero.value.style.setProperty('--grid-x', `${event.clientX - bounds.left}px`)
  hero.value.style.setProperty('--grid-y', `${event.clientY - bounds.top}px`)
}
</script>

<template>
  <main class="craft-home">
    <section ref="hero" class="craft-hero" @pointermove="updateGrid">
      <div class="craft-grid" aria-hidden="true" />
      <div class="craft-shell craft-hero-layout">
        <div class="craft-hero-copy">
          <h1>
            <template v-for="(line, index) in copy.title.split('\n')" :key="line">
              <br v-if="index">
              {{ line }}
            </template>
          </h1>
          <p>{{ copy.description }}</p>
          <div class="craft-actions">
            <a class="craft-button craft-button-primary" :href="downloadLink">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 3v12m-5-5 5 5 5-5M5 20h14" />
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
        </div>

        <figure class="craft-product-frame">
          <span class="craft-product-beam" aria-hidden="true" />
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

    <section class="craft-proof" aria-label="Craft Hub workflow">
      <div class="craft-shell craft-proof-list">
        <article v-for="proof in copy.proofs" :key="proof.title" class="craft-proof-item">
          <svg v-if="proof.icon === 'search'" aria-hidden="true" viewBox="0 0 32 32">
            <circle cx="14" cy="14" r="9" />
            <path d="m21 21 7 7" />
          </svg>
          <svg v-else-if="proof.icon === 'review'" aria-hidden="true" viewBox="0 0 32 32">
            <path d="M5 8h3m4 0h15M5 16h3m4 0h15M5 24h3m4 0h15" />
          </svg>
          <svg v-else aria-hidden="true" viewBox="0 0 32 32">
            <path d="M16 3 27 7v8c0 7-4.4 11.8-11 14-6.6-2.2-11-7-11-14V7l11-4Z" />
            <path d="m11 16 3 3 7-7" />
          </svg>
          <div>
            <h2>{{ proof.title }}</h2>
            <p>{{ proof.description }}</p>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.craft-home {
  --craft-accent: #1558e8;
  --craft-accent-hover: #0d49c8;
  --craft-border: #dfe5ef;
  --craft-grid: rgb(21 88 232 / 10%);
  --craft-muted: #526079;
  overflow: hidden;
  color: #090d16;
  background: #fff;
}

.craft-shell {
  width: min(1440px, calc(100% - 72px));
  margin: 0 auto;
}

.craft-hero {
  --grid-x: 75%;
  --grid-y: 35%;
  position: relative;
  min-height: min(790px, calc(100vh - var(--vp-nav-height)));
  border-bottom: 1px solid var(--craft-border);
  background: #fff;
}

.craft-grid {
  position: absolute;
  pointer-events: none;
  background-image: linear-gradient(var(--craft-grid) 1px, transparent 1px), linear-gradient(90deg, var(--craft-grid) 1px, transparent 1px);
  background-position: center;
  background-size: 72px 72px;
  inset: 0 0 0 42%;
  mask-image: radial-gradient(560px circle at var(--grid-x) var(--grid-y), #000 4%, transparent 72%);
  transition: mask-position 120ms ease-out;
}

.craft-hero-layout {
  display: grid;
  grid-template-columns: minmax(390px, .78fr) minmax(660px, 1.42fr);
  gap: clamp(52px, 6vw, 104px);
  align-items: center;
  min-height: inherit;
  padding: 68px 0 78px;
}

.craft-hero-copy {
  position: relative;
  z-index: 2;
}

.craft-hero-copy h1 {
  max-width: 620px;
  margin: 0;
  font-size: clamp(58px, 5.4vw, 84px);
  font-weight: 760;
  line-height: .98;
  letter-spacing: -.058em;
}

.craft-hero-copy > p:not(.craft-release-note) {
  max-width: 590px;
  margin: 34px 0 0;
  color: var(--craft-muted);
  font-size: clamp(18px, 1.45vw, 22px);
  line-height: 1.55;
}

.craft-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 38px;
}

.craft-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 56px;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 0 22px;
  font-size: 16px;
  font-weight: 650;
  line-height: 1;
  text-decoration: none;
  transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease, color 160ms ease, transform 160ms ease;
}

.craft-button:hover {
  transform: translateY(-1px);
}

.craft-button:focus-visible {
  outline: 3px solid rgb(21 88 232 / 24%);
  outline-offset: 3px;
}

.craft-button svg {
  width: 21px;
  height: 21px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.craft-button-primary {
  color: #fff;
  background: var(--craft-accent);
  box-shadow: 0 8px 22px rgb(21 88 232 / 18%);
}

.craft-button-primary:hover {
  color: #fff;
  background: var(--craft-accent-hover);
  box-shadow: 0 12px 28px rgb(21 88 232 / 24%);
}

.craft-button-secondary {
  border-color: #cfd7e4;
  color: var(--craft-accent);
  background: #fff;
}

.craft-button-secondary:hover {
  border-color: #9fb3d5;
  color: var(--craft-accent-hover);
  background: #f8faff;
}

.craft-release-note {
  margin: 28px 0 0;
  color: #68748a;
  font-size: 15px;
  line-height: 1.5;
}

.craft-product-frame {
  position: relative;
  z-index: 1;
  min-width: 0;
  margin: 0 -7vw 0 0;
  border: 1px solid #b9c8e2;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 34px 80px rgb(30 53 91 / 16%), 0 8px 24px rgb(30 53 91 / 10%);
}

.craft-product-frame::after {
  position: absolute;
  z-index: -2;
  border: 1px dashed rgb(21 88 232 / 34%);
  border-radius: 20px;
  content: '';
  inset: -30px -26px 30px 10%;
}

.craft-product-frame img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 13px;
}

.craft-product-beam {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  border: 1px solid transparent;
  border-radius: inherit;
  background: linear-gradient(105deg, transparent 28%, rgb(21 88 232 / 78%) 45%, rgb(80 200 255 / 88%) 50%, transparent 66%) border-box;
  background-size: 280% 100%;
  inset: -1px;
  mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  animation: craft-beam 6s linear infinite;
}

.craft-proof {
  background: #fff;
}

.craft-proof-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.craft-proof-item {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 20px;
  min-width: 0;
  padding: 48px 38px 54px;
}

.craft-proof-item + .craft-proof-item {
  border-left: 1px solid var(--craft-border);
}

.craft-proof-item svg {
  width: 42px;
  height: 42px;
  fill: none;
  stroke: var(--craft-accent);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.craft-proof-item h2 {
  margin: 0;
  font-size: 23px;
  font-weight: 720;
  line-height: 1.2;
  letter-spacing: -.025em;
}

.craft-proof-item p {
  margin: 13px 0 0;
  color: var(--craft-muted);
  font-size: 15px;
  line-height: 1.55;
}

.dark .craft-home {
  --craft-accent: #79a2ff;
  --craft-accent-hover: #9ab8ff;
  --craft-border: #2c3442;
  --craft-grid: rgb(121 162 255 / 12%);
  --craft-muted: #a9b2c2;
  color: #f5f7fb;
  background: #0d1016;
}

.dark .craft-hero,
.dark .craft-proof {
  background: #0d1016;
}

.dark .craft-button-secondary,
.dark .craft-product-frame {
  border-color: #3d4657;
  color: #a9c0ff;
  background: #131821;
}

.dark .craft-button-secondary:hover {
  background: #192131;
}

.dark .craft-product-frame img {
  opacity: .92;
}

@keyframes craft-beam {
  from { background-position: 140% 0; }
  to { background-position: -140% 0; }
}

@media (max-width: 1180px) {
  .craft-shell {
    width: min(100% - 48px, 1080px);
  }

  .craft-hero-layout {
    grid-template-columns: 1fr;
    gap: 54px;
    padding-top: 76px;
  }

  .craft-hero-copy {
    max-width: 760px;
  }

  .craft-product-frame {
    margin: 0;
  }
}

@media (max-width: 760px) {
  .craft-shell {
    width: calc(100% - 32px);
  }

  .craft-grid {
    inset-inline-start: 8%;
  }

  .craft-hero-layout {
    gap: 42px;
    padding: 58px 0 48px;
  }

  .craft-hero-copy h1 {
    font-size: clamp(47px, 14vw, 64px);
  }

  .craft-hero-copy > p:not(.craft-release-note) {
    margin-top: 26px;
    font-size: 18px;
  }

  .craft-actions {
    display: grid;
    margin-top: 30px;
  }

  .craft-button {
    width: 100%;
  }

  .craft-product-frame::after {
    inset: -16px -10px 14px 8%;
  }

  .craft-proof-list {
    grid-template-columns: 1fr;
  }

  .craft-proof-item {
    padding: 34px 8px;
  }

  .craft-proof-item + .craft-proof-item {
    border-top: 1px solid var(--craft-border);
    border-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .craft-product-beam {
    animation: none;
    background-position: 50% 0;
  }

  .craft-button,
  .craft-grid {
    transition: none;
  }
}
</style>
