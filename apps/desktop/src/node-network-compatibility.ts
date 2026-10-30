import { Socket } from 'node:net'
import process from 'node:process'

const installed = Symbol.for('craft-hub.socket-type-of-service-compatibility')
type TypeOfServiceSocket = Socket & { setTypeOfService?: (value: number) => Socket }

/**
 * Keep an unsupported macOS socket QoS hint from escaping Node's bundled undici connection callbacks.
 * This does not intercept request errors: only EINVAL from setTypeOfService is optional.
 * Install before network use in each owned process; Node versions without this API need no change.
 */
export function installNodeNetworkCompatibility(): void {
  if (process.platform !== 'darwin')
    return
  const prototype: TypeOfServiceSocket = Socket.prototype
  const original = prototype.setTypeOfService
  if (typeof original !== 'function' || Reflect.get(original, installed) === true)
    return
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'setTypeOfService')
  if (descriptor?.configurable === false && descriptor.writable === false)
    return
  const setHint = original

  function setTypeOfService(this: Socket, value: number): Socket {
    try {
      return setHint.call(this, value)
    }
    catch (error) {
      if (error !== null && typeof error === 'object'
        && 'code' in error && error.code === 'EINVAL'
        && 'syscall' in error && error.syscall === 'setTypeOfService') {
        return this
      }
      throw error
    }
  }
  Object.defineProperty(setTypeOfService, installed, { value: true })
  Object.defineProperty(prototype, 'setTypeOfService', { ...descriptor, value: setTypeOfService })
}
