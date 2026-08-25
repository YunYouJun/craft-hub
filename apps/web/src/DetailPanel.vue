<script setup lang="ts">
import { Icon } from './icons'
import { useWorkbenchStore } from './store'

const store = useWorkbenchStore()
</script>

<template>
  <main class="detail-panel">
    <div v-if="!store.selectedCapability" class="detail-empty">Select a command or skill</div>
    <template v-else>
      <header class="detail-heading">
        <span class="detail-icon"><Icon :name="store.selectedCapability.kind === 'command' ? 'terminal' : 'skill'" /></span>
        <div>
          <h2>{{ store.selectedCapability.name }}</h2>
          <p>{{ store.selectedCapability.source }}</p>
        </div>
        <span v-if="store.selectedProject" class="trust-state" :class="store.selectedProject.trust">
          <Icon name="shield" /> {{ store.selectedProject.trust === 'trusted' ? 'Trusted' : 'Untrusted' }}
        </span>
      </header>

      <template v-if="store.selectedCapability.kind === 'command'">
        <dl class="preview-grid">
          <dt>Command</dt><dd><code>{{ [store.selectedCapability.invocation.command, ...store.selectedCapability.invocation.args].join(' ') }}</code></dd>
          <dt>Working directory</dt><dd>{{ store.selectedCapability.invocation.cwd }}</dd>
          <dt>Required environment</dt><dd>{{ store.selectedCapability.invocation.requiredEnv.join(', ') || 'None' }}</dd>
        </dl>
        <button v-if="store.selectedProject?.trust !== 'trusted'" class="primary-button trust-button" @click="store.trustProject">
          <Icon name="shield" /> Trust this project
        </button>
        <button v-else class="primary-button" :disabled="store.busy" @click="store.runSelected">
          <Icon name="play" /> {{ store.busy ? 'Running…' : 'Run command' }}
        </button>
        <p v-if="store.error" class="error-message">{{ store.error }}</p>

        <section class="run-panel">
          <div class="run-header"><Icon name="terminal" /> Run: {{ store.selectedCapability.name }}</div>
          <pre v-if="store.run"><span class="prompt">$ {{ [store.run.command, ...store.run.args].join(' ') }}</span>
{{ store.run.stdout }}<span v-if="store.run.stderr" class="stderr">{{ store.run.stderr }}</span>
<span class="exit">Exit {{ store.run.exitCode ?? '—' }}</span></pre>
          <div v-else class="run-empty">Run output will appear here.</div>
        </section>
      </template>

      <template v-else>
        <p class="skill-description">{{ store.selectedCapability.description }}</p>
        <div class="skill-actions">
          <button class="secondary-button">Inspect skill</button>
          <button class="primary-button" disabled>Use with Agent · next slice</button>
        </div>
        <pre class="skill-content">{{ store.selectedCapability.content }}</pre>
      </template>
    </template>
  </main>
</template>
