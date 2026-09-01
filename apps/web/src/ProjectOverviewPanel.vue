<script setup lang="ts">
import type { Capability, CommandCapability, CommandCategory, CommandPackage, CommandPackageLink } from 'craft-hub'
import { computed, ref } from 'vue'
import { Button as UiButton } from './components/ui/button'
import { Icon } from './icons'
import { useI18n } from './i18n'
import MarkdownPreview from './MarkdownPreview.vue'
import { compareOverviewPackages } from './package-overview'
import { useWorkbenchStore } from './store'

const store = useWorkbenchStore()
const { t } = useI18n()
const rootPackage = computed(() => store.commandPackages.find(commandPackage => commandPackage.root))
const activePackage = computed(() => store.selectedPackagePath ? store.selectedPackage : rootPackage.value)
const isPackageOverview = computed(() => Boolean(store.selectedPackagePath))
const overviewTitle = computed(() => isPackageOverview.value
  ? activePackage.value?.name ?? activePackage.value?.relativePath ?? ''
  : store.selectedProject?.name ?? '')
const overviewDescription = computed(() => activePackage.value?.description ?? t(isPackageOverview.value ? 'packageDescriptionMissing' : 'projectDescriptionMissing'))
const readme = computed(() => store.projectOverview?.readme)
const packageLinkError = ref('')
const toolGroups = computed(() => (activePackage.value?.toolGroups ?? []).map(group => ({
  ...group,
  commands: activePackage.value ? packageCommands(activePackage.value).filter(command => command.toolGroupId === group.id) : [],
  links: (activePackage.value?.links ?? []).filter(link => link.toolGroupId === group.id),
})).filter(group => group.commands.length || group.links.length))
const ungroupedLinks = computed(() => (activePackage.value?.links ?? []).filter(link => !link.toolGroupId))

const packages = computed(() => store.commandPackages
  .filter(commandPackage => !commandPackage.root && !commandPackage.hidden)
  .sort(compareOverviewPackages))
const recentPackages = computed(() => store.recentPackagePaths
  .map(path => packages.value.find(commandPackage => commandPackage.relativePath === path))
  .filter((commandPackage): commandPackage is CommandPackage => Boolean(commandPackage)))

function packageCommands(commandPackage: CommandPackage): CommandCapability[] {
  return store.capabilities.filter((capability): capability is CommandCapability => capability.kind === 'command'
    && (capability.package?.relativePath ?? '.') === commandPackage.relativePath)
}

function configuredAction(selector: string, commandPackage: CommandPackage): Capability | undefined {
  const candidates = store.capabilities.filter(capability => capability.kind === 'skill'
    || (capability.package?.relativePath ?? '.') === commandPackage.relativePath)
  const exact = candidates.find(capability => capability.id === selector)
  if (exact)
    return exact
  const matches = candidates.filter(capability => capability.name === selector || `${capability.source}:${capability.name}` === selector)
  return matches.length === 1 ? matches[0] : undefined
}

function actions(commandPackage: CommandPackage, limit = 4): Capability[] {
  const commands = packageCommands(commandPackage).filter(command => !command.toolGroupId)
  if (commandPackage.quickActions?.length) {
    const configured = commandPackage.quickActions
      .map(selector => configuredAction(selector, commandPackage))
      .filter((capability): capability is Capability => capability !== undefined)
      .filter(capability => capability.kind !== 'command' || !capability.toolGroupId)
    if (configured.length)
      return configured.slice(0, limit)
  }
  const categories: CommandCategory[] = ['develop', 'build', 'test', 'quality']
  return categories.map(category => commands.find(command => command.category === category)).filter((command): command is CommandCapability => Boolean(command)).slice(0, limit)
}

function packageCommandCount(commandPackage: CommandPackage): number {
  return packageCommands(commandPackage).length
}

function openPackage(commandPackage: CommandPackage): void {
  void store.selectPackage(commandPackage.relativePath)
}

function openAction(commandPackage: CommandPackage, capability: Capability): void {
  const packagePath = commandPackage.root ? '' : commandPackage.relativePath
  if (isPackageOverview.value)
    store.openPackageCapability(capability.id, packagePath)
  else
    store.selectCapability(capability.id, packagePath)
}

async function openPackageLink(link: CommandPackageLink): Promise<void> {
  packageLinkError.value = ''
  try {
    if (window.craftHubDesktop?.openExternalUrl)
      await window.craftHubDesktop.openExternalUrl(link.url)
    else
      window.open(link.url, '_blank', 'noopener,noreferrer')
  }
  catch (caught) {
    packageLinkError.value = t('openFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
}

</script>

<template>
  <section class="project-overview-panel" data-testid="project-overview-panel">
    <div v-if="store.projectOverviewLoading" class="overview-state"><Icon name="loading" /> {{ t('loadingProjectOverview') }}</div>
    <div v-else-if="store.projectOverviewError" class="overview-state error-message" role="alert">{{ store.projectOverviewError }}</div>
    <template v-else-if="activePackage && store.selectedProject">
      <header class="overview-heading">
        <UiButton v-if="isPackageOverview" class="overview-back" size="compact" variant="ghost" @click="store.clearPackageSelection">
          <Icon name="arrowRight" /> {{ t('backToProjectOverview') }}
        </UiButton>
        <div class="overview-title-row">
          <span class="overview-icon"><Icon :name="isPackageOverview ? 'package' : 'folderOpen'" /></span>
          <div>
            <h2>{{ overviewTitle }}</h2>
            <p v-if="isPackageOverview">{{ activePackage.relativePath }}</p>
          </div>
        </div>
        <p class="overview-description">{{ overviewDescription }}</p>
      </header>

      <section v-for="group in toolGroups" :key="group.id" class="overview-section overview-actions overview-tool-group" :data-testid="`package-tool-group-${group.id}`">
        <div class="overview-tool-heading">
          <h3><Icon name="terminal" /> {{ group.title }}</h3>
          <p v-if="group.description">{{ group.description }}</p>
        </div>
        <div>
          <UiButton v-for="capability in group.commands" :key="capability.id" @click="openAction(activePackage, capability)">
            <Icon name="terminal" /> {{ capability.name }}
          </UiButton>
          <UiButton v-for="link in group.links" :key="link.id" :title="link.description" :data-testid="`package-link-${link.id}`" @click="openPackageLink(link)">
            <Icon name="web" /> {{ link.title }}
          </UiButton>
        </div>
        <p>{{ t('toolCommandsReviewHint') }}</p>
        <p v-if="packageLinkError" class="error-message" role="alert">{{ packageLinkError }}</p>
      </section>

      <section v-if="actions(activePackage).length || ungroupedLinks.length" class="overview-section overview-actions">
        <h3>{{ t('commonActions') }}</h3>
        <div>
          <UiButton v-for="capability in actions(activePackage)" :key="capability.id" @click="openAction(activePackage, capability)">
            <Icon :name="capability.kind === 'command' ? 'terminal' : 'skill'" /> {{ capability.name }}
          </UiButton>
          <UiButton v-for="link in ungroupedLinks" :key="link.id" :title="link.description" :data-testid="`package-link-${link.id}`" @click="openPackageLink(link)">
            <Icon name="web" /> {{ link.title }}
          </UiButton>
        </div>
        <p>{{ t('commonActionsReviewHint') }}</p>
        <p v-if="packageLinkError" class="error-message" role="alert">{{ packageLinkError }}</p>
      </section>

      <section v-if="!isPackageOverview && packages.length" class="overview-section">
        <div v-if="recentPackages.length" class="recent-packages" :aria-label="t('recentPackages')">
          <h3>{{ t('recentPackages') }}</h3>
          <div>
            <button v-for="commandPackage in recentPackages" :key="commandPackage.relativePath" type="button" @click="openPackage(commandPackage)">
              <Icon name="package" />
              <span><strong>{{ commandPackage.name ?? commandPackage.relativePath }}</strong><small>{{ commandPackage.relativePath }}</small></span>
              <Icon name="arrowRight" />
            </button>
          </div>
        </div>
        <div class="overview-section-heading">
          <h3>{{ t('projectPackages') }}</h3>
          <span>{{ t('packageCount', { count: String(packages.length) }) }}</span>
        </div>
        <div class="package-card-grid">
          <article v-for="commandPackage in packages" :key="commandPackage.relativePath" class="package-card" :class="{ featured: commandPackage.featured }">
            <button class="package-card-main" type="button" @click="openPackage(commandPackage)">
              <span class="package-card-icon"><Icon name="package" /></span>
              <span class="package-card-copy">
                <strong>{{ commandPackage.name ?? commandPackage.relativePath }}</strong>
                <small>{{ commandPackage.relativePath }}</small>
                <span>{{ commandPackage.description ?? t('packageDescriptionMissing') }}</span>
              </span>
              <Icon name="arrowRight" />
            </button>
            <footer>
              <span>{{ t('packageCommandCount', { count: String(packageCommandCount(commandPackage)) }) }}</span>
              <div v-if="actions(commandPackage, 2).length">
                <button v-for="capability in actions(commandPackage, 2)" :key="capability.id" type="button" @click="openAction(commandPackage, capability)">
                  <Icon :name="capability.kind === 'command' ? 'terminal' : 'skill'" /> {{ capability.name }}
                </button>
              </div>
            </footer>
          </article>
        </div>
      </section>

      <section class="overview-section readme-section">
        <div class="overview-section-heading">
          <h3><Icon name="docs" /> README</h3>
          <span v-if="readme?.path">{{ readme.path }}</span>
        </div>
        <MarkdownPreview v-if="readme?.status === 'found' && readme.content && readme.path" :content="readme.content" :project-id="store.selectedProject.id" :readme-path="readme.path" />
        <div v-else class="readme-empty">
          <Icon name="docs" />
          <span>{{ readme?.status === 'too-large' ? t('readmeTooLarge') : readme?.status === 'invalid' || readme?.status === 'unreadable' ? readme.message : t('readmeMissing') }}</span>
        </div>
      </section>
    </template>
  </section>
</template>
