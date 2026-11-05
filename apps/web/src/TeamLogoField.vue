<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue'
import { Button as UiButton } from './components/ui/button'
import { Input } from './components/ui/input'
import { useI18n } from './i18n'
import VisualIcon from './VisualIcon.vue'

defineProps<{ disabled?: boolean }>()
const model = defineModel<string>({ default: '' })
const pending = defineModel<boolean>('pending', { default: false })
const { locale } = useI18n()
const copy = (zh: string, en: string): string => locale.value === 'zh-CN' ? zh : en
const inputId = useId()
const fileInput = ref<HTMLInputElement>()
const error = ref('')
let revision = 0
const imageUrl = computed({
  get: () => model.value.startsWith('data:') ? '' : model.value,
  set: (value: string) => { revision++; pending.value = false; error.value = ''; model.value = value.trim() },
})

function reset(): void {
  revision++
  pending.value = false
  error.value = ''
  model.value = ''
}

async function chooseFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file)
    return
  const current = ++revision
  error.value = ''
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif', 'image/avif'].includes(file.type) || file.size > 256 * 1024) {
    pending.value = false
    error.value = copy('请选择不超过 256 KB 的 PNG、JPEG、WebP、SVG、GIF 或 AVIF 图片。', 'Choose a PNG, JPEG, WebP, SVG, GIF or AVIF image up to 256 KB.')
    return
  }
  pending.value = true
  try {
    const value = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image'))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    if (current === revision)
      model.value = value
  }
  catch {
    if (current === revision)
      error.value = copy('无法读取图片，请重试。', 'Could not read the image. Please retry.')
  }
  finally {
    if (current === revision)
      pending.value = false
  }
}

onBeforeUnmount(() => { revision++; pending.value = false })
</script>

<template>
  <fieldset class="team-logo-field" :disabled="disabled">
    <legend>{{ copy('团队 logo', 'Team logo') }}</legend>
    <div class="team-logo-preview-row">
      <VisualIcon class="team-logo-preview" :icon="model || undefined" fallback="team" :monochrome="false" framed />
      <UiButton size="compact" data-testid="upload-team-logo" @click="fileInput?.click()">{{ copy('上传图片', 'Upload image') }}</UiButton>
      <UiButton size="compact" :disabled="!model && !pending" data-testid="reset-team-logo" @click="reset">{{ copy('恢复默认', 'Reset to default') }}</UiButton>
      <input ref="fileInput" hidden type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/avif" data-testid="team-logo-file" @change="chooseFile">
    </div>
    <label :for="inputId">{{ copy('图片链接（可选）', 'Image URL (optional)') }}</label>
    <Input :id="inputId" v-model="imageUrl" type="url" maxlength="4096" placeholder="https://example.com/logo.png" data-testid="team-logo-url" />
    <p class="team-logo-help">{{ copy('上传的图片会随团队配置保存，单张不超过 256 KB。', 'Uploaded images are saved with the Team configuration, up to 256 KB each.') }}</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
  </fieldset>
</template>

<style scoped>
.team-logo-field { display: grid; gap: var(--space-2); min-width: 0; margin: 0; padding: 0; border: 0; }
.team-logo-field legend { padding: 0; margin-bottom: var(--space-2); font-size: var(--font-size-control); font-weight: 500; }
.team-logo-preview-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.team-logo-field .team-logo-preview { flex: none; width: 40px; height: 40px; border-radius: var(--control-radius); padding: 5px; }
.team-logo-help { margin: 0; color: var(--muted); font-size: var(--font-size-caption); line-height: var(--line-height-body); }
</style>
