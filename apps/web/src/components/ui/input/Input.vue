<script setup lang="ts">
// Adapted from shadcn-vue: keep native attributes and the host's semantic tokens.
const model = defineModel<string>({ default: '' })
</script>

<template>
  <input v-model="model" data-slot="input" class="ui-form-control" />
</template>
