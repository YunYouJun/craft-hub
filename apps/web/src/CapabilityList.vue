<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from './icons'
import { useWorkbenchStore } from './store'

const store = useWorkbenchStore()
const query = ref('')
const filter = ref<'all' | 'command' | 'skill'>('all')
const filtered = computed(() => store.capabilities.filter((item) => {
  return (filter.value === 'all' || item.kind === filter.value)
    && `${item.name} ${item.description ?? ''}`.toLowerCase().includes(query.value.toLowerCase())
}))
</script>

<template>
  <section class="capability-panel">
    <div class="panel-heading">
      <h2>Project Palette</h2><kbd>⌘K</kbd>
    </div>
    <label class="search-box">
      <Icon name="search" />
      <input v-model="query" placeholder="Search commands and skills…">
    </label>
    <nav class="filters" aria-label="Capability filters">
      <button v-for="item in ['all', 'command', 'skill'] as const" :key="item" :class="{ active: filter === item }" @click="filter = item">
        {{ item === 'all' ? 'All' : item === 'command' ? 'Commands' : 'Skills' }}
      </button>
    </nav>
    <div class="capability-list">
      <button
        v-for="capability in filtered"
        :key="capability.id"
        class="capability-row"
        :class="{ selected: capability.id === store.selectedCapabilityId }"
        @click="store.selectedCapabilityId = capability.id"
      >
        <span class="capability-icon"><Icon :name="capability.kind === 'command' ? 'terminal' : 'skill'" /></span>
        <span><strong>{{ capability.name }}</strong><small>{{ capability.source }}</small></span>
      </button>
      <div v-if="!filtered.length" class="empty">No matching capabilities</div>
    </div>
  </section>
</template>
