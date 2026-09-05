<script setup lang="ts">
import { celebration } from './celebration'
import { Icon } from './icons'
import { useI18n } from './i18n'

const props = defineProps<{ context: 'help' | 'settings' }>()
const { t } = useI18n()
</script>

<template>
  <section class="settings-section celebration-settings" :data-testid="`celebration-${props.context}`">
    <div class="celebration-settings-row">
      <span class="celebration-settings-icon" aria-hidden="true"><Icon name="skill" /></span>
      <span class="celebration-settings-copy">
        <h3>{{ t('celebration') }}</h3>
        <p>{{ t(props.context === 'help' ? 'celebrationHelpDescription' : 'celebrationSettingsDescription') }}</p>
      </span>
      <button
        type="button"
        class="settings-save-button celebration-test-button"
        :data-testid="`test-celebration-${props.context}`"
        @click="celebration.fire()"
      >
        {{ t('testCelebration') }}
      </button>
    </div>
    <div v-if="props.context === 'help'" class="celebration-prompt">
      <strong>{{ t('celebrationPromptLabel') }}</strong>
      <code>{{ t('celebrationExamplePrompt') }}</code>
    </div>
  </section>
</template>
