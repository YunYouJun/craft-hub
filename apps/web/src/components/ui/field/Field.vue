<script setup lang="ts">
withDefaults(defineProps<{ orientation?: 'vertical' | 'horizontal' }>(), { orientation: 'vertical' })
</script>
<template>
  <div role="group" data-slot="field" :data-orientation="orientation"><slot /></div>
</template>
