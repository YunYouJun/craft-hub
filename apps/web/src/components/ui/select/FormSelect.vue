<script setup lang="ts">
import { computed } from 'vue'
import Select from './Select.vue'
import SelectContent from './SelectContent.vue'
import SelectGroup from './SelectGroup.vue'
import SelectItem from './SelectItem.vue'
import SelectOptionContent from './SelectOptionContent.vue'
import SelectTrigger from './SelectTrigger.vue'
import SelectValue from './SelectValue.vue'

export interface FormSelectOption {
  value: string
  label?: string
  icon?: string
}

const props = withDefaults(defineProps<{
  modelValue?: string
  options?: readonly FormSelectOption[]
  id?: string
  required?: boolean
  testId?: string
}>(), {
  modelValue: '',
  options: () => [],
  id: undefined,
  testId: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const value = computed({
  get: () => props.modelValue,
  set: nextValue => emit('update:modelValue', nextValue),
})
const selectedOption = computed(() => props.options.find(option => option.value === props.modelValue))
</script>

<template>
  <Select v-model="value" :required="required">
    <SelectTrigger :id="id" :aria-required="required" :data-testid="testId">
      <SelectValue>
        <SelectOptionContent
          v-if="selectedOption"
          :icon="selectedOption.icon"
          :label="selectedOption.label ?? selectedOption.value"
        />
      </SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        <SelectItem v-for="option in options" :key="option.value" :value="option.value">
          <SelectOptionContent :icon="option.icon" :label="option.label ?? option.value" />
        </SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>
</template>
