<script setup lang="ts">
// Adapted from shadcn-vue: keep native attributes and the host's semantic tokens.
const model = defineModel<string>({ default: '' })
</script>

<template>
  <textarea v-model="model" data-slot="textarea" class="ui-form-control" />
</template>
