<script setup lang="ts">
import workbenchPreviewDark from '../assets/workbench-preview-dark.webp'
import workbenchPreviewLight from '../assets/workbench-preview-light.webp'

withDefaults(defineProps<{
  alt: string
  title?: string
  compact?: boolean
}>(), {
  title: 'Craft Hub',
  compact: false,
})
</script>

<template>
  <figure class="ch-window-frame" :class="{ 'is-compact': compact }">
    <div class="ch-window-chrome" aria-hidden="true">
      <span class="ch-window-dots">
        <i class="dot-close" />
        <i class="dot-min" />
        <i class="dot-max" />
      </span>
      <span class="ch-window-title">{{ title }}</span>
      <span />
    </div>
    <div class="ch-window-viewport">
      <img
        class="ch-preview-light"
        :src="workbenchPreviewLight"
        :alt="alt"
        width="2560"
        height="1600"
        fetchpriority="high"
      >
      <img
        class="ch-preview-dark"
        :src="workbenchPreviewDark"
        :alt="alt"
        width="2560"
        height="1600"
      >
    </div>
  </figure>
</template>

<style scoped>
.ch-window-frame {
  margin: 0;
  overflow: hidden;
  border-radius: var(--ch-radius-frame);
  background: var(--ch-surface);
  box-shadow: var(--ch-shadow-hero);
}

.ch-window-frame.is-compact {
  border-radius: var(--ch-radius-card);
}

.ch-window-chrome {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr) 76px;
  align-items: center;
  height: 34px;
  border-bottom: 1px solid var(--ch-border);
  background: var(--ch-surface-subtle);
  padding: 0 14px;
}

.ch-window-frame.is-compact .ch-window-chrome {
  grid-template-columns: 68px minmax(0, 1fr) 68px;
  height: 30px;
  padding: 0 12px;
}

.ch-window-dots {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.ch-window-frame.is-compact .ch-window-dots {
  gap: 6px;
}

.ch-window-dots i {
  display: block;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 12%);
}

.ch-window-frame.is-compact .ch-window-dots i {
  width: 10px;
  height: 10px;
}

.dot-close { background: #ff5f57; }
.dot-min { background: #febc2e; }
.dot-max { background: #28c840; }

.ch-window-title {
  color: var(--ch-text-muted);
  font-size: 12px;
  font-weight: 550;
  text-align: center;
  letter-spacing: -0.01em;
}

.ch-window-frame.is-compact .ch-window-title {
  font-size: 11px;
}

.ch-window-viewport img {
  display: block;
  width: 100%;
  height: auto;
}

.ch-window-viewport img.ch-preview-dark {
  display: none;
}

@media (max-width: 720px) {
  .ch-window-frame {
    border-radius: 14px;
  }

  .ch-window-chrome {
    height: 28px;
    padding: 0 10px;
  }

  .ch-window-dots i {
    width: 9px;
    height: 9px;
  }
}
</style>
