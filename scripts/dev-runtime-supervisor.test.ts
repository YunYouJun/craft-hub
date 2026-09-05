import type { DevRuntimeProcess } from './dev-runtime-supervisor'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { DevRuntimeSupervisor } from './dev-runtime-supervisor'

class FakeRuntimeProcess extends EventEmitter implements DevRuntimeProcess {
  readonly kill = vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    queueMicrotask(() => this.emit('exit', null, signal))
    return true
  })
}

describe('development runtime supervisor', () => {
  it('starts once per successful build revision and stops the old runtime before replacement', async () => {
    const processes: FakeRuntimeProcess[] = []
    const launch = vi.fn(() => {
      const process = new FakeRuntimeProcess()
      processes.push(process)
      return process
    })
    const unexpectedExit = vi.fn()
    const supervisor = new DevRuntimeSupervisor(launch, unexpectedExit)

    await supervisor.applyBuild('revision-a')
    await supervisor.applyBuild('revision-a')
    await supervisor.applyBuild('revision-b')

    expect(launch).toHaveBeenCalledTimes(2)
    expect(processes[0]!.kill).toHaveBeenCalledWith('SIGTERM')
    expect(unexpectedExit).not.toHaveBeenCalled()
    await supervisor.stop()
    expect(processes[1]!.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('distinguishes an unplanned clean exit from a Runtime failure', async () => {
    const process = new FakeRuntimeProcess()
    const unexpectedExit = vi.fn()
    const cleanExit = vi.fn()
    const supervisor = new DevRuntimeSupervisor(() => process, unexpectedExit, {
      onCleanExit: cleanExit,
      processName: 'Desktop application',
    })

    await supervisor.applyBuild('revision-a')
    process.emit('exit', 0, null)

    expect(cleanExit).toHaveBeenCalledWith({ code: 0, signal: null })
    expect(unexpectedExit).not.toHaveBeenCalled()
  })

  it('includes the managed process name in unexpected exit errors', async () => {
    const process = new FakeRuntimeProcess()
    const unexpectedExit = vi.fn()
    const supervisor = new DevRuntimeSupervisor(() => process, unexpectedExit, {
      processName: 'Desktop application',
    })

    await supervisor.applyBuild('revision-a')
    process.emit('exit', 1, null)

    expect(unexpectedExit).toHaveBeenCalledWith(new Error('Desktop application exited with code 1 and signal null'))
  })
})
