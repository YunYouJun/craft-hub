import type { DevelopmentProcessExit } from './dev-environment-lifecycle.ts'
import type { DevRuntimeProcess } from './dev-runtime-supervisor.ts'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { waitForDevelopmentEnvironmentExit } from './dev-environment-lifecycle.ts'
import { DevRuntimeSupervisor } from './dev-runtime-supervisor.ts'

class FakeRuntimeProcess extends EventEmitter implements DevRuntimeProcess {
  readonly kill = vi.fn(() => {
    queueMicrotask(() => this.emit('exit', 0, null))
    return true
  })
}

function deferred<T>(): {
  promise: Promise<T>
  reject: (error: Error) => void
  resolve: (value: T) => void
} {
  let reject!: (error: Error) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise
    resolve = resolvePromise
  })
  return { promise, reject, resolve }
}

describe('development environment lifecycle', () => {
  it('keeps running when the Runtime supervisor replaces a successful build', async () => {
    const buildWatcherExit = deferred<DevelopmentProcessExit>()
    const runtimeCleanExit = deferred<DevelopmentProcessExit>()
    const runtimeFailure = deferred<never>()
    const webServerClosed = deferred<Omit<DevelopmentProcessExit, 'name'>>()
    const processes: FakeRuntimeProcess[] = []
    const supervisor = new DevRuntimeSupervisor(() => {
      const process = new FakeRuntimeProcess()
      processes.push(process)
      return process
    }, runtimeFailure.reject, {
      onCleanExit: exit => runtimeCleanExit.resolve({ ...exit, name: 'Desktop application' }),
      processName: 'Desktop application',
    })

    await supervisor.applyBuild('revision-a')
    const environmentExit = waitForDevelopmentEnvironmentExit({
      buildWatcherExit: buildWatcherExit.promise,
      runtimeCleanExit: runtimeCleanExit.promise,
      runtimeFailure: runtimeFailure.promise,
      webServerClosed: webServerClosed.promise,
    })
    await supervisor.applyBuild('revision-b')

    const state = await Promise.race([
      environmentExit.then(() => 'stopped', () => 'failed'),
      new Promise<'running'>(resolve => setImmediate(resolve, 'running')),
    ])
    expect(state).toBe('running')

    buildWatcherExit.resolve({ code: 0, name: 'Runtime build watcher', signal: null })
    await expect(environmentExit).resolves.toEqual({
      code: 0,
      name: 'Runtime build watcher',
      signal: null,
    })
    await supervisor.stop()
    expect(processes).toHaveLength(2)
  })

  it('reports an unplanned clean Desktop exit without treating a planned replacement as clean', async () => {
    const buildWatcherExit = deferred<DevelopmentProcessExit>()
    const runtimeCleanExit = deferred<DevelopmentProcessExit>()
    const runtimeFailure = deferred<never>()
    const webServerClosed = deferred<Omit<DevelopmentProcessExit, 'name'>>()
    const process = new FakeRuntimeProcess()
    const failRuntime = vi.fn(runtimeFailure.reject)
    const supervisor = new DevRuntimeSupervisor(() => process, failRuntime, {
      onCleanExit: exit => runtimeCleanExit.resolve({ ...exit, name: 'Desktop application' }),
      processName: 'Desktop application',
    })

    await supervisor.applyBuild('revision-a')
    const environmentExit = waitForDevelopmentEnvironmentExit({
      buildWatcherExit: buildWatcherExit.promise,
      runtimeCleanExit: runtimeCleanExit.promise,
      runtimeFailure: runtimeFailure.promise,
      webServerClosed: webServerClosed.promise,
    })
    process.emit('exit', 0, null)

    await expect(environmentExit).resolves.toEqual({
      code: 0,
      name: 'Desktop application',
      signal: null,
    })
    expect(failRuntime).not.toHaveBeenCalled()
  })

  it('fails when the supervised Runtime exits unsuccessfully', async () => {
    const buildWatcherExit = deferred<DevelopmentProcessExit>()
    const runtimeCleanExit = deferred<DevelopmentProcessExit>()
    const runtimeFailure = deferred<never>()
    const webServerClosed = deferred<Omit<DevelopmentProcessExit, 'name'>>()
    const process = new FakeRuntimeProcess()
    const supervisor = new DevRuntimeSupervisor(() => process, runtimeFailure.reject, {
      onCleanExit: exit => runtimeCleanExit.resolve({ ...exit, name: 'Desktop application' }),
      processName: 'Desktop application',
    })

    await supervisor.applyBuild('revision-a')
    const environmentExit = waitForDevelopmentEnvironmentExit({
      buildWatcherExit: buildWatcherExit.promise,
      runtimeCleanExit: runtimeCleanExit.promise,
      runtimeFailure: runtimeFailure.promise,
      webServerClosed: webServerClosed.promise,
    })
    process.emit('exit', 1, null)

    await expect(environmentExit).rejects.toThrow('Desktop application exited with code 1 and signal null')
  })
})
