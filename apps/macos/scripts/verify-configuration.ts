import type { ConfigurationManagementPage, IntegrationPresentation, ResolvedIntegrationContribution, SoftwareCatalogSnapshot, SoftwareFavoritesSnapshot } from 'craft-hub'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Exercise the packaged provider in a disposable home. No installed app, real configuration or remote Git operation is used.
assert.equal(process.platform, 'darwin', 'This verifier requires macOS')
const app = resolve(process.argv[2] ?? fileURLToPath(new URL('../build/Craft Hub Prototype.app', import.meta.url)))
const sidecar = join(app, 'Contents/Resources/app/apps/desktop/dist/sidecar.mjs')
await access(sidecar)
const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-native-configuration-')))
const repository = join(root, 'repository')
const home = join(root, 'home')
const env = {
  HOME: home,
  CRAFT_HUB_SIDECAR_DIR: join(root, 'profile'),
  DOTFILES_REPO_ROOT: repository,
  PATH: [dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter),
  LANG: 'C.UTF-8',
  CRAFT_HUB_BACKUP_KEY_FIXTURE: randomBytes(32).toString('hex'),
}
let child: ReturnType<typeof spawn> | undefined
try {
  await mkdir(join(repository, 'home'), { recursive: true })
  await mkdir(home)
  await mkdir(join(root, 'profile/runtime'), { recursive: true })
  await writeFile(join(root, 'profile/runtime/host-extensions.json'), JSON.stringify({ schemaVersion: 1, extensions: [], bundled: { 'microsoft-todo': true } }))
  await mkdir(join(home, '.codex'))
  if (process.env.CRAFT_HUB_TEST_CODEX) {
    assert(isAbsolute(process.env.CRAFT_HUB_TEST_CODEX), 'CRAFT_HUB_TEST_CODEX must be an absolute installed CLI path')
    await access(process.env.CRAFT_HUB_TEST_CODEX)
    await mkdir(join(home, '.local/bin'), { recursive: true })
    await symlink(process.env.CRAFT_HUB_TEST_CODEX, join(home, '.local/bin/codex'))
  }
  const codexFixture = '[plugins."native-fixture@catalog"]\nenabled = true\n'
  await writeFile(join(home, '.codex/config.toml'), codexFixture)
  const localFile = join(home, '.zshrc')
  const sourceFile = join(repository, 'home/dot_zshrc')
  const local = 'export NATIVE_CONFIGURATION_FIXTURE=local\n'
  const source = 'export NATIVE_CONFIGURATION_FIXTURE=source\n'
  const changed = 'export NATIVE_CONFIGURATION_FIXTURE=changed\n'
  await writeFile(localFile, local)
  await writeFile(sourceFile, source)
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-C', repository, ...args], { env, stdio: 'ignore', timeout: 10000 })
  git('init', '--initial-branch=main')
  git('add', 'home/dot_zshrc')
  git('-c', 'user.name=Native Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'test: add isolated configuration fixture')
  child = spawn(process.execPath, [sidecar], { cwd: home, env, detached: true, stdio: ['pipe', 'pipe', 'ignore'], shell: false })
  const running = child
  const handshake = await new Promise<{ version: number, url: string, nativeApiToken: string }>((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('Sidecar handshake timed out')), 20000)
    const fail = () => {
      clearTimeout(timer)
      reject(new Error('Sidecar exited before its handshake'))
    }
    running.once('error', fail)
    running.once('exit', fail)
    running.stdout!.setEncoding('utf8')
    running.stdout!.on('data', (chunk: string) => {
      output += chunk
      if (output.length > 16384) {
        clearTimeout(timer)
        reject(new Error('Oversized sidecar handshake'))
        return
      }
      const newline = output.indexOf('\n')
      if (newline < 0)
        return
      clearTimeout(timer)
      running.removeListener('exit', fail)
      try {
        resolve(JSON.parse(output.slice(0, newline)))
      }
      catch { reject(new Error('Invalid sidecar handshake')) }
    })
  })
  assert.equal(handshake.version, 1)
  const origin = new URL(handshake.url).origin
  async function request<T>(path: string, body?: unknown): Promise<{ response: Response, value: T }> {
    const response = await fetch(new URL(path, origin), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin, 'authorization': `Bearer ${handshake.nativeApiToken}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    })
    return { response, value: await response.json() as T }
  }
  // Exercise the packaged favorites projection and mutation without opening or installing applications.
  const software = await request<SoftwareCatalogSnapshot>('/api/software?discovery=none')
  assert.equal(software.response.status, 200)
  assert(software.value.favorites?.version === 1)
  const initialFavorites = software.value.favorites
  const sourceCatalog = software.value.sources.find(source => source.items.some(item => !initialFavorites.matches.some(match => match.sourceId === source.id && match.softwareId === item.id)))
  assert(sourceCatalog, 'No unsaved software fixture in the bundled catalog')
  const softwareItem = sourceCatalog.items.find(item => !initialFavorites.matches.some(match => match.sourceId === sourceCatalog.id && match.softwareId === item.id))!
  const favoriteInput = { action: 'add', sourceId: sourceCatalog.id, softwareId: softwareItem.id, locale: 'en', revision: initialFavorites.revision }
  assert.equal((await request('/api/software-favorites', { ...favoriteInput, softwareId: 'missing-native-fixture' })).response.status, 404)
  assert.equal((await request('/api/software-favorites', { ...favoriteInput, launch: { application: 'unreviewed' } })).response.status, 400)
  const addedFavorite = await request<SoftwareFavoritesSnapshot>('/api/software-favorites', favoriteInput)
  assert.equal(addedFavorite.response.status, 200)
  assert.equal(addedFavorite.value.tools.length, initialFavorites.tools.length + 1)
  const savedFavorite = addedFavorite.value.matches.find(match => match.sourceId === sourceCatalog.id && match.softwareId === softwareItem.id)
  assert(savedFavorite)
  assert.equal((await request('/api/software-favorites', favoriteInput)).response.status, 409)
  const rereadFavorites = await request<SoftwareCatalogSnapshot>('/api/software?discovery=none')
  assert.deepEqual(rereadFavorites.value.favorites, addedFavorite.value)
  const duplicateFavorite = await request<SoftwareFavoritesSnapshot>('/api/software-favorites', { ...favoriteInput, revision: addedFavorite.value.revision })
  assert.equal(duplicateFavorite.response.status, 200)
  assert.deepEqual(duplicateFavorite.value.tools, addedFavorite.value.tools)
  const removedFavorite = await request<SoftwareFavoritesSnapshot>('/api/software-favorites', { action: 'remove', toolId: savedFavorite.toolId, revision: duplicateFavorite.value.revision })
  assert.equal(removedFavorite.response.status, 200)
  assert.deepEqual(removedFavorite.value.tools, initialFavorites.tools)
  assert.equal((await request('/api/native-host/open-workbench-tool', { toolId: 'missing-native-fixture' })).response.status, 400)
  const noNativeAuthorization = await fetch(new URL('/api/native-host/open-workbench-tool', origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ toolId: 'missing-native-fixture' }),
    signal: AbortSignal.timeout(5000),
  })
  assert.equal(noNativeAuthorization.status, 403)
  const { value: catalog } = await request<{ integrations: ResolvedIntegrationContribution[] }>('/api/integrations')
  // The shipped declarations have no generic form fixture. Verify the bundled routing/authentication
  // and missing-review boundary here; successful form flows use dedicated runtime HTTP fixtures.
  const formsPath = '/api/integrations/microsoft-todo/forms/'
  assert.equal((await request(`${formsPath}prepare`, { selector: { viewId: 'missing-native-fixture', blockId: 'missing' }, values: {} })).response.status, 409)
  assert.equal((await request(`${formsPath}execute`, { planId: 'missing-native-fixture', confirmed: true })).response.status, 409)
  assert.equal((await request(`${formsPath}execute`, { planId: 'missing-native-fixture', confirmed: true, input: { override: true } })).response.status, 400)
  assert.equal((await request(`${formsPath}discard`, { planId: 'missing-native-fixture' })).response.status, 200)
  const unauthenticatedForm = await fetch(new URL(`${formsPath}prepare`, origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ selector: { viewId: 'missing-native-fixture', blockId: 'missing' }, values: {} }),
    signal: AbortSignal.timeout(5000),
  })
  assert.equal(unauthenticatedForm.status, 403)
  // Enable only the shipped declaration in this disposable profile. Its connection remains disabled: no login or connector request.
  const todo = catalog.integrations.find(item => item.id === 'microsoft-todo')
  assert(todo, 'The bundled connection declaration is absent')
  const statusAction = todo.actions.find(item => item.operation === 'connection.status')!
  const connectAction = todo.actions.find(item => item.operation === 'connection.update')!
  const connection = await request<IntegrationPresentation>(`/api/integrations/${todo.id}/actions/${statusAction.id}?presentation=workbench-v1`, { input: { locale: 'en' }, confirmed: false })
  assert.equal(connection.response.status, 200)
  assert(connection.value.kind === 'connection' && connection.value.connection.reviewRevision)
  assert.equal(connection.value.connection.connected, false)
  assert(connection.value.connection.forms?.some(form => form.id === 'device-code'))
  const connectionPath = `/api/integrations/${todo.id}/actions/${connectAction.id}?presentation=workbench-v1`
  const connectionReview = { input: { method: 'missing-native-fixture', locale: 'en' }, reviewedConnection: connection.value.connection.reviewRevision, reviewedAction: { operation: 'connection.update', effect: 'local-write' } }
  assert.equal((await request(connectionPath, connectionReview)).response.status, 409)
  assert.equal((await request(connectionPath, { ...connectionReview, confirmed: true })).response.status, 409)
  assert.equal((await request(connectionPath, { ...connectionReview, input: { method: 'device-code', locale: 'en' }, confirmed: true, reviewedConnection: 'outdated' })).response.status, 409)
  await assert.rejects(access(join(root, 'profile/runtime/integrations/microsoft-todo/connection.json')))
  const codex = catalog.integrations.find(item => item.id === 'codex-configuration')
  const codexRead = codex?.actions.find(action => action.operation === 'configuration.list')
  assert(codex && codexRead, 'The bundled configuration-list declaration is absent')
  const codexPresentation = await request<IntegrationPresentation>(`/api/integrations/${codex.id}/actions/${codexRead.id}?presentation=workbench-v1`, { input: { preview: true }, confirmed: false })
  assert.equal(codexPresentation.response.status, 200, (codexPresentation.value as unknown as { error?: string }).error ?? 'Codex preview failed')
  assert(codexPresentation.value.kind === 'entities')
  const codexItem = codexPresentation.value.page.items.find(item => item.id === 'native-fixture@catalog')
  assert(codexItem?.key && codexItem.configurationToggle === undefined, 'A metadata preview must not grant configuration write authority')
  assert.equal(await readFile(join(home, '.codex/config.toml'), 'utf8'), codexFixture)
  const contribution = catalog.integrations.find(item => item.id === 'workstation')
  assert(contribution, 'The bundled configuration provider is absent')
  const read = contribution.actions.find(item => item.operation === 'configuration.read')!
  const update = contribution.actions.find(item => item.operation === 'configuration.update')!
  const readPath = `/api/integrations/${contribution.id}/actions/${read.id}?presentation=workbench-v1`
  assert.equal((await request(readPath, { input: { operation: 'inspect' }, confirmed: false, reviewedAction: { operation: 'configuration.update', effect: 'local-write' } })).response.status, 409)
  assert.deepEqual((await request<IntegrationPresentation>(readPath, { input: { operation: 'inspect' }, confirmed: false })).value, { version: 1, kind: 'unsupported' })
  async function action(input: Record<string, unknown>, confirmed: boolean) {
    const id = input.operation === 'inspect' ? read.id : update.id
    return request<ConfigurationManagementPage>(`/api/integrations/${encodeURIComponent(contribution!.id)}/actions/${encodeURIComponent(id)}`, { input, confirmed })
  }
  async function inspect() {
    const result = await action({ operation: 'inspect' }, false)
    assert.equal(result.response.status, 200)
    const item = result.value.items.find(item => item.id === 'file:.zshrc')
    assert(item && result.value.presentation?.writableItemIds.includes(item.id), 'Fixture is not writable in shared presentation')
    return item
  }
  async function preview() {
    const item = await inspect()
    const result = await action({ operation: 'preview', decisions: [{ id: item.id, revision: item.revision, choice: 'source' }] }, true)
    assert.equal(result.response.status, 200)
    assert(result.value.preview)
    assert.deepEqual(result.value.preview.changes.map(change => change.path), [localFile])
    return result.value.preview.planId
  }
  const item = await inspect()
  const denied = await action({ operation: 'preview', decisions: [{ id: item.id, revision: item.revision, choice: 'source' }] }, false)
  assert.equal(denied.response.status, 409)
  const stalePlan = await preview()
  assert.equal(await readFile(localFile, 'utf8'), local, 'Preview modified a file')
  await writeFile(sourceFile, changed)
  const stale = await action({ operation: 'apply', planId: stalePlan }, true)
  assert(!stale.response.ok, 'Changed source was accepted by an old plan')
  assert.equal(await readFile(localFile, 'utf8'), local)
  const planId = await preview()
  const applied = await action({ operation: 'apply', planId }, true)
  assert.equal(applied.response.status, 200)
  assert.equal(applied.value.history?.find(plan => plan.planId === planId)?.state, 'applied')
  assert.equal(await readFile(localFile, 'utf8'), changed)
  const restored = await action({ operation: 'restore', planId }, true)
  assert.equal(restored.response.status, 200)
  assert.equal(restored.value.history?.find(plan => plan.planId === planId)?.state, 'restored')
  assert.equal(await readFile(localFile, 'utf8'), local)
  const protectionPlan = await preview()
  const protectionApplied = await action({ operation: 'apply', planId: protectionPlan }, true)
  assert.equal(protectionApplied.response.status, 200)
  assert.equal(await readFile(localFile, 'utf8'), changed)
  const later = 'export NATIVE_CONFIGURATION_FIXTURE=later-edit\n'
  await writeFile(localFile, later)
  const protectedRecovery = await action({ operation: 'restore', planId: protectionPlan }, true)
  assert(!protectedRecovery.response.ok, 'Recovery replaced a later edit')
  assert.equal(await readFile(localFile, 'utf8'), later)
  // Matching bytes do not restore the original file revision; recovery must still preserve independent activity.
  await writeFile(localFile, changed)
  const changedRevision = await action({ operation: 'restore', planId: protectionPlan }, true)
  assert(!changedRevision.response.ok, 'Recovery accepted independently rewritten bytes')
  assert.equal(await readFile(localFile, 'utf8'), changed)
  assert.equal(await readFile(sourceFile, 'utf8'), changed)
  // The pinned provider must actually offer registry and backup operations in the release payload.
  async function registry() {
    const page = await action({ operation: 'inspect' }, false)
    assert.equal(page.response.status, 200)
    assert(page.value.registry && page.value.operationSupport?.operations['backup-preview']?.supported)
    return page.value.registry
  }
  async function changeRegistry(change: Record<string, unknown>) {
    return action({ operation: 'repositories-update', registry: { revision: (await registry()).revision, ...change } }, true)
  }
  const beforeRegistry = await registry()
  const office = join(root, 'work-checkout')
  await mkdir(office)
  execFileSync('/usr/bin/git', ['init', '--quiet', office], { env, stdio: 'ignore', timeout: 10000 })
  const officeSource = { id: 'office', name: 'Work fixture', root: office, kind: 'dotfiles', audience: 'work', enabled: true }
  assert.equal((await action({ operation: 'repositories-update', registry: { revision: beforeRegistry.revision, action: 'save-source', source: officeSource } }, false)).response.status, 409)
  assert.equal((await changeRegistry({ action: 'save-source', source: officeSource })).response.status, 200)
  assert(!(await action({ operation: 'repositories-update', registry: { revision: beforeRegistry.revision, action: 'remove-source', id: 'office' } }, true)).response.ok)
  const target = { id: 'backup', name: 'Backup fixture', directory: 'configuration', audience: 'personal', driver: 'workstation', sourceIds: ['public'], keyEnvironment: 'CRAFT_HUB_BACKUP_KEY_FIXTURE' }
  assert(!(await changeRegistry({ action: 'save-target', target: { ...target, sourceIds: ['office'] } })).response.ok)
  assert.equal((await changeRegistry({ action: 'save-target', target })).response.status, 200)
  assert(!(await action({ operation: 'backup-preview', targetId: target.id, revision: (await registry()).revision, action: 'save' }, true)).response.ok, 'Reserved target performed backup work')
  const backups = join(root, 'backup-checkout')
  await mkdir(backups)
  execFileSync('/usr/bin/git', ['init', '--quiet', backups], { env, stdio: 'ignore', timeout: 10000 })
  assert.equal((await changeRegistry({ action: 'save-target', target: { ...target, root: backups } })).response.status, 200)
  async function backup(actionName: string, resolution?: string) {
    return action({ operation: 'backup-preview', targetId: target.id, revision: (await registry()).revision, action: actionName, ...(resolution ? { resolution } : {}) }, true)
  }
  assert(!(await backup('save')).response.ok, 'Competing configuration owners were accepted for backup')
  assert.equal((await changeRegistry({ action: 'save-source', source: { ...officeSource, enabled: false } })).response.status, 200)
  const encryptedPlan = await backup('save')
  assert.equal(encryptedPlan.response.status, 200, (encryptedPlan.value as unknown as { error?: string }).error ?? 'Encrypted backup preview failed')
  assert(encryptedPlan.value.preview)
  const archivePath = join(backups, target.directory, 'configuration.backup.json')
  await assert.rejects(access(archivePath), { code: 'ENOENT' })
  const archiveApplied = await action({ operation: 'apply', planId: encryptedPlan.value.preview.planId }, true)
  assert.equal(archiveApplied.value.history?.find(plan => plan.planId === encryptedPlan.value.preview!.planId)?.state, 'applied')
  const encrypted = await readFile(archivePath, 'utf8')
  assert(!encrypted.includes(changed) && !encrypted.includes(env.CRAFT_HUB_BACKUP_KEY_FIXTURE))
  const homeSentinel = 'export NATIVE_CONFIGURATION_FIXTURE=home-not-restored\n'
  await writeFile(localFile, homeSentinel)
  await writeFile(sourceFile, 'export NATIVE_CONFIGURATION_FIXTURE=source-edited-after-backup\n')
  const sourceRecovery = await backup('restore')
  assert.equal(sourceRecovery.response.status, 200)
  assert(sourceRecovery.value.preview)
  assert.deepEqual(sourceRecovery.value.preview.changes.map(change => change.path), [sourceFile])
  const recoveredSource = await action({ operation: 'apply', planId: sourceRecovery.value.preview.planId }, true)
  assert.equal(recoveredSource.value.history?.find(plan => plan.planId === sourceRecovery.value.preview!.planId)?.state, 'applied')
  assert.equal(await readFile(sourceFile, 'utf8'), changed)
  assert.equal(await readFile(localFile, 'utf8'), homeSentinel, 'Backup recovery changed HOME configuration')
  await writeFile(archivePath, `${encrypted} `)
  assert(!(await backup('save')).response.ok, 'Changed archive was silently replaced')
  assert.equal((await backup('save', 'replace')).response.status, 200)
  await writeFile(archivePath, JSON.stringify({ ...JSON.parse(encrypted), data: 'AAAA' }))
  assert(!(await backup('restore')).response.ok, 'Tampered archive was accepted')
  assert.equal(await readFile(sourceFile, 'utf8'), changed)
  assert.equal((await changeRegistry({ action: 'remove-target', id: target.id })).response.status, 200)
  assert.equal((await changeRegistry({ action: 'remove-source', id: 'office' })).response.status, 200)
  await access(office)
  await access(archivePath)
  const persistedRegistry = join(home, '.local/state/workstation/configuration-v1/repositories.json')
  assert.equal((await stat(persistedRegistry)).mode & 0o777, 0o600)
  assert(!(await readFile(persistedRegistry, 'utf8')).includes(env.CRAFT_HUB_BACKUP_KEY_FIXTURE))
  const projects = await request<{ projects: unknown[] }>('/api/projects')
  assert.deepEqual(projects.value.projects, [])
  running.stdin!.end()
  const timer = setTimeout(() => running.kill('SIGTERM'), 10000)
  const [code] = await once(running, 'exit')
  clearTimeout(timer)
  assert.equal(code, 0)
  console.log(JSON.stringify({ connectionReview: 'disabled bundled connection, confirmation and stale/missing form rejection verified without login', integrationPresentation: 'real isolated Codex preview, explicit unsupported result and reviewed operation verified', favorites: 'catalog IDs, revision, preservation and native authorization passed', discovery: 'read-only', confirmation: 409, preview: 'no file changes', stalePlan: 'rejected', apply: 'passed', laterEdits: 'preserved', rewrittenRevision: 'protected', restore: 'passed', registry: 'revision and audience enforced', backup: 'encrypted save and source restoration passed', changedArchive: 'requires review', tamperedArchive: 'rejected', projects: 0, sidecarExit: code }))
}
finally {
  if (child?.exitCode === null && child.signalCode === null && child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    }
    catch { /* Only this verifier's owned process group is eligible for cleanup. */ }
    await once(child, 'exit').catch(() => {})
  }
  await rm(root, { recursive: true, force: true })
}
