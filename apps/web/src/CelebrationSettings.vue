<script setup lang="ts">
import { celebration } from './celebration'
import { Button as UiButton } from './components/ui/button'
import { SettingsRow, SettingsSection } from './components/ui/settings'
import { useI18n } from './i18n'

const props = defineProps<{ context: 'help' | 'settings' }>()
const { t } = useI18n()
</script>

<template>
  <SettingsSection class="celebration-settings" :title="t('celebration')" :data-testid="`celebration-${props.context}`">
    <SettingsRow :label="t('celebration')" :description="t(props.context === 'help' ? 'celebrationHelpDescription' : 'celebrationSettingsDescription')">
      <template #control>
        <UiButton size="compact" :data-testid="`test-celebration-${props.context}`" @click="celebration.fire()">{{ t('testCelebration') }}</UiButton>
      </template>
    </SettingsRow>
    <template v-if="props.context === 'help'" #footer>
      <div class="celebration-prompt">
        <strong>{{ t('celebrationPromptLabel') }}</strong>
        <code>{{ t('celebrationExamplePrompt') }}</code>
      </div>
    </template>
  </SettingsSection>
</template>
