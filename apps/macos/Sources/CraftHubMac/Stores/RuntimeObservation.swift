import CraftHubMacCore
import Foundation
import Observation

/// Owns a subscription for the app lifetime, independently of window creation and view tasks.
@MainActor @Observable
final class RuntimeObservation {
  enum State { case stopped, connecting, connected, reconnecting }
  private(set) var state: State = .stopped
  @ObservationIgnored var onInvalidation: (Set<RuntimeChange>) -> Void = { _ in }
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var subscription: Task<Void, Never>?
  @ObservationIgnored private var delivery: Task<Void, Never>?
  @ObservationIgnored private var pending = Set<RuntimeChange>()
  private let observe: (RuntimeConnection, @escaping RuntimeEventStream.Handler) async -> Void
  private let waitForDelivery: () async throws -> Void

  init(
    observe: @escaping (RuntimeConnection, @escaping RuntimeEventStream.Handler) async -> Void = {
      await RuntimeEventStream(connection: $0).observe($1)
    },
    waitForDelivery: @escaping () async throws -> Void = { try await Task.sleep(for: .milliseconds(150)) }
  ) {
    self.observe = observe
    self.waitForDelivery = waitForDelivery
  }

  func connect(_ connection: RuntimeConnection?) {
    subscription?.cancel()
    delivery?.cancel()
    subscription = nil
    delivery = nil
    pending.removeAll()
    generation = UUID()
    state = connection == nil ? .stopped : .connecting
    guard let connection else { return }
    let current = generation
    let observe = observe
    subscription = Task { [weak self] in
      await observe(connection) { [weak self] event in await self?.receive(event, generation: current) }
    }
  }

  private func receive(_ event: RuntimeStreamEvent, generation: UUID) {
    guard generation == self.generation else { return }
    switch event {
    case .connected:
      state = .connected
      pending.formUnion(RuntimeChange.allCases)
    case .disconnected:
      state = .reconnecting
      return
    case .changed(let change): pending.insert(change)
    }
    // Fixed-window coalescing prevents bursts from cancelling an in-flight snapshot or starving its delivery.
    guard delivery == nil else { return }
    let waitForDelivery = waitForDelivery
    delivery = Task { [weak self] in
      try? await waitForDelivery()
      guard !Task.isCancelled, let self, generation == self.generation else { return }
      let changes = pending
      pending.removeAll()
      delivery = nil
      onInvalidation(changes)
    }
  }

  deinit {
    subscription?.cancel()
    delivery?.cancel()
  }
}
