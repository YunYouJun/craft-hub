import CraftHubMacCore
import Foundation
import Observation

/// Owns a reviewed execution independently of views. Navigation never implicitly stops a running process.
@MainActor @Observable
final class ProjectCommandModel {
  let terminalSession = NativeTerminalSession()
  private(set) var projectID: String?
  private(set) var capabilityID: String?
  private(set) var details: ProjectDetails?
  private(set) var command: ProjectCommand?
  private(set) var invocation: ProjectCommandInvocation?
  private(set) var review: ProjectCommandReview?
  private(set) var run: ProjectCommandRun?
  private(set) var history: [ProjectCommandRun] = []
  private(set) var loading = false
  private(set) var busy = false
  private(set) var stale = true
  private(set) var uncertain = false
  private(set) var error: String?
  private(set) var terminalOutput = ""
  private(set) var outputOrderKnown = true
  private(set) var stopping = false
  private(set) var inputUncertain = false
  private(set) var previewing = false
  private(set) var previewError: String?
  var inputValues: [String: String] = [:] {
    didSet {
      if inputValues != oldValue {
        cancelReview()
        schedulePreview()
      }
    }
  }
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var context = UUID()
  @ObservationIgnored private var connection = UUID()
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var starting = false
  @ObservationIgnored private var streamID = UUID()
  @ObservationIgnored private var streamTask: Task<Void, Never>?
  @ObservationIgnored private var reviewInputs: [String: String]?
  @ObservationIgnored private var recovering = false
  @ObservationIgnored private var recoveryRunID: String?
  @ObservationIgnored private var inputQueue: [(runID: String, data: Data)] = []
  @ObservationIgnored private var queuedInputBytes = 0
  @ObservationIgnored private var inputTask: Task<Void, Never>?
  @ObservationIgnored private var previewTask: Task<Void, Never>?
  @ObservationIgnored private var previewIdentity = UUID()
  private var liveRunID: String?
  @ObservationIgnored private var recoveryScope: (projectID: String, capabilityID: String)?
  @ObservationIgnored private var observedRunIDs: Set<String>?
  @ObservationIgnored private let outputLimit: Int

  init(outputLimit: Int = 10 * 1024 * 1024) { self.outputLimit = max(1, outputLimit) }

  var releaseFallback: Bool { command?.requiresWebReleaseReview == true }
  var visibleInputs: [ProjectCommandInput] {
    (command?.inputs ?? []).filter { $0.isVisible(inputValues) }
  }
  var canPrepare: Bool {
    client != nil && command != nil && !stale && !loading && !busy && !starting && !uncertain && !releaseFallback
      && run?.isRunning != true
      && command?.availability?.available != false
  }
  var canChangeContext: Bool { !starting && !stopping && !uncertain }
  /// Output provenance survives completion; permission to send input is gated separately by the runtime status.
  var terminalOutputIsLive: Bool { run?.id == liveRunID && liveRunID != nil }

  func connect(_ client: RuntimeAPIClient?) {
    guard self.client !== client else { return }
    cancelReview()
    invalidatePreview()
    terminalSession.discard()
    liveRunID = nil
    let interrupted = busy || run?.isRunning == true
    if let run, interrupted {
      recoveryRunID = run.id
      recoveryScope = (run.projectId, run.capabilityId)
      if projectID == nil || capabilityID == nil {
        projectID = run.projectId
        capabilityID = run.capabilityId
      }
    }
    run = nil
    terminalOutput = ""
    outputOrderKnown = true
    history = []
    observedRunIDs = nil
    streamID = UUID()
    streamTask?.cancel()
    streamTask = nil
    inputUncertain = false
    inputTask?.cancel()
    inputTask = nil
    inputQueue = []
    queuedInputBytes = 0
    connection = UUID()
    context = UUID()
    self.client = client
    details = nil
    command = nil
    invocation = nil
    loading = false
    busy = false
    starting = false
    stopping = false
    recovering = false
    stale = true
    uncertain = interrupted || uncertain
    revision += 1
  }

  func select(project: String, capability: String) {
    guard canChangeContext else { return }
    if projectID == project && capabilityID == capability { return }
    cancelReview()
    invalidatePreview()
    context = UUID()
    projectID = project
    capabilityID = capability
    details = nil
    command = nil
    invocation = nil
    inputValues = [:]
    history = []
    error = nil
    stale = true
    loading = false
    revision += 1
  }

  /// Closing a detail leaves the execution stream and terminal state alive for return navigation.
  func close() {
    guard canChangeContext else { return }
    cancelReview()
    invalidatePreview()
    context = UUID()
    projectID = nil
    capabilityID = nil
    details = nil
    command = nil
    invocation = nil
    inputValues = [:]
    history = []
    stale = true
    loading = false
    error = nil
  }

  func editInput(_ id: String, value: String) {
    guard !starting, command?.inputs?.contains(where: { $0.id == id }) == true else { return }
    inputValues[id] = value
  }

  func invalidate(_ changes: Set<RuntimeChange>) {
    if !changes.isDisjoint(with: [
      .projects, .projectCatalog, .plugins, .pluginUpdate, .userConfig, .settings, .configurationSync,
    ]) {
      revision += 1
      stale = true
      cancelReview()
      invalidatePreview()
    }
    if changes.contains(.runs), !busy {
      Task { await refreshRuns() }
    }
  }

  func load(force: Bool = false) async {
    guard let client, let projectID, let capabilityID, !loading else { return }
    if force {
      revision += 1
      stale = true
      cancelReview()
      invalidatePreview()
    }
    guard stale else { return }
    let token = context
    loading = true
    defer { if token == context { loading = false } }
    repeat {
      let requestedRevision = revision
      do {
        let snapshot = try await client.projectDetails(projectID: projectID)
        guard token == context, !Task.isCancelled else { return }
        guard let value = snapshot.discovery.capabilities.first(where: { $0.id == capabilityID })?.command else {
          command = nil
          invocation = nil
          throw RuntimeAPIError.rejected(404, L10n.text.copy("命令已不在项目中。", "This command is no longer in the project."))
        }
        details = snapshot
        command = value
        var values: [String: String] = [:]
        for input in value.inputs ?? [] { values[input.id] = inputValues[input.id] ?? input.defaultValue ?? "" }
        inputValues = values
        error = nil
        stale = requestedRevision != revision
      } catch {
        guard token == context, !Task.isCancelled else { return }
        self.error = error.localizedDescription
        stale = true
        return
      }
    } while stale && token == context && !Task.isCancelled
    schedulePreview(immediate: true)
    await previewTask?.value
    await refreshRuns()
  }

  func prepareReview() async {
    guard canPrepare, let client, let projectID, let capabilityID else { return }
    let token = context
    let requestedRevision = revision
    let inputs = inputValues
    cancelReview()
    invalidatePreview()
    starting = true
    error = nil
    defer { if token == context { starting = false } }
    do {
      let value = try await client.reviewProjectCommand(
        projectID: projectID, capabilityID: capabilityID, inputs: inputs)
      guard token == context, revision == requestedRevision, inputs == inputValues, !Task.isCancelled else {
        try? await client.cancelProjectCommandReview(projectID: projectID, reviewID: value.reviewId)
        return
      }
      command = value.capability
      invocation = value.invocation
      reviewInputs = inputs
      review = value
    } catch {
      guard token == context, !Task.isCancelled else { return }
      self.error = error.localizedDescription
      // A conflict can signal a changed declaration, including a command newly marked as a release.
      if Self.isConflict(error) { stale = true }
    }
  }

  func cancelReview() {
    guard let review else {
      reviewInputs = nil
      return
    }
    self.review = nil
    reviewInputs = nil
    guard let client else { return }
    Task { try? await client.cancelProjectCommandReview(projectID: review.project.id, reviewID: review.reviewId) }
  }

  private func invalidatePreview() {
    previewTask?.cancel()
    previewTask = nil
    previewIdentity = UUID()
    invocation = nil
    previewError = nil
    previewing = false
  }

  /// Preview is read-only and bound to the exact input snapshot. Invalid drafts never retain old argv.
  private func schedulePreview(immediate: Bool = false) {
    invalidatePreview()
    guard let client, let projectID, let capabilityID, command != nil, !stale, !releaseFallback else { return }
    let token = context
    let request = previewIdentity
    let requestedRevision = revision
    let inputs = inputValues
    previewing = true
    previewTask = Task {
      defer {
        if token == context, request == previewIdentity {
          previewing = false
          previewTask = nil
        }
      }
      do {
        if !immediate { try await Task.sleep(for: .milliseconds(150)) }
        try Task.checkCancellation()
        let value = try await client.previewProjectCommand(
          projectID: projectID, capabilityID: capabilityID, inputs: inputs)
        guard token == context, request == previewIdentity, revision == requestedRevision,
          inputValues == inputs, !Task.isCancelled
        else { return }
        invocation = value
      } catch {
        guard token == context, request == previewIdentity, revision == requestedRevision,
          inputValues == inputs, !Task.isCancelled
        else { return }
        previewError = error.localizedDescription
      }
    }
  }

  func confirmReview() async {
    guard let client, let review, let inputs = reviewInputs, !busy, !uncertain,
      review.project.id == projectID, review.capability.id == capabilityID, inputs == inputValues,
      !stale, !review.capability.requiresWebReleaseReview
    else { return }
    self.review = nil
    reviewInputs = nil
    starting = true
    busy = true
    error = nil
    let requestID = UUID()
    liveRunID = nil
    streamID = requestID
    let session = connection
    streamTask = Task { [self] in
      var attemptedRun = false
      var acceptedRunID: String?
      defer {
        if streamID == requestID {
          starting = false
          busy = false
          streamTask = nil
        }
      }
      do {
        if review.requiresTrust {
          let project = try await client.trustProjectCommand(projectID: review.project.id, reviewID: review.reviewId)
          guard project.id == review.project.id, project.path == review.project.path, project.trust == "trusted" else {
            throw RuntimeAPIError.invalidResponse
          }
        }
        try Task.checkCancellation()
        attemptedRun = true
        _ = try await client.runProjectCommand(
          projectID: review.project.id, capabilityID: review.capability.id, inputs: inputs, reviewID: review.reviewId
        ) { [weak self] update in
          guard let self, self.streamID == requestID, self.connection == session else { return }
          if acceptedRunID == nil {
            acceptedRunID = update.run.id
            self.liveRunID = update.run.id
            self.recoveryRunID = update.run.id
            self.recoveryScope = (update.run.projectId, update.run.capabilityId)
            self.inputUncertain = false
            self.terminalOutput = update.run.stdout + update.run.stderr
            self.outputOrderKnown = update.run.stderr.isEmpty
          }
          self.starting = false
          self.run = update.run
          if let chunk = update.appendedOutput { self.appendTerminal(chunk) }
          self.updateTerminalSession(appendedOutput: update.appendedOutput)
          self.remember(update.run)
        }
        guard streamID == requestID, connection == session else { return }
        uncertain = false
      } catch {
        guard streamID == requestID, connection == session else { return }
        self.error = error.localizedDescription
        liveRunID = nil
        terminalSession.suspendInput()
        if !attemptedRun && review.requiresTrust && !Self.isDefiniteRejection(error) {
          uncertain = true
          recoveryRunID = nil
          stale = true
          self.error = L10n.text.copy(
            "无法确认项目是否已获信任。请重新读取项目状态并核对，再重新审阅命令。",
            "Project trust could not be confirmed. Reload and check the project, then review the command again.")
          if let snapshot = try? await client.projectDetails(projectID: review.project.id),
            streamID == requestID, connection == session, projectID == review.project.id
          {
            details = snapshot
          }
          await refreshRuns()
        } else if attemptedRun && !Self.isDefiniteRejection(error) {
          uncertain = true
          self.error = L10n.text.copy(
            "连接已中断，命令可能仍在运行。请重新读取运行记录；不会自动重试。",
            "The connection ended and the command may still be running. Reload run history; it will not be retried.")
          if acceptedRunID == nil {
            run = nil
            recoveryRunID = nil
          }
          await refreshRuns()
        } else {
          stale = true
        }
        try? await client.cancelProjectCommandReview(projectID: review.project.id, reviewID: review.reviewId)
      }
    }
    await streamTask?.value
  }

  func refreshRuns() async {
    guard let client, !recovering else { return }
    let session = connection
    let token = context
    recovering = true
    defer { if session == connection { recovering = false } }
    do {
      let records = try await client.projectCommandRuns()
      guard session == connection, !Task.isCancelled else { return }
      observedRunIDs = Set(records.map(\.id))
      if token == context {
        history = records.filter { $0.projectId == projectID && $0.capabilityId == capabilityID }
          .sorted { $0.startedAt > $1.startedAt }
      }
      if let current = run, let restored = records.first(where: { $0.id == current.id }) {
        if !busy || uncertain {
          run = restored
          if liveRunID != restored.id {
            terminalOutput = restored.stdout + restored.stderr
            outputOrderKnown = restored.stderr.isEmpty
          }
          if recoveryRunID == restored.id { uncertain = false }
          updateTerminalSession()
        }
      } else if run == nil, let recoveryRunID, let scope = recoveryScope,
        let restored = records.first(where: {
          $0.id == recoveryRunID && $0.projectId == scope.projectID && $0.capabilityId == scope.capabilityID
        })
      {
        run = restored
        terminalOutput = restored.stdout + restored.stderr
        outputOrderKnown = restored.stderr.isEmpty
        uncertain = false
        updateTerminalSession()
      }
    } catch {
      if session == connection { self.error = error.localizedDescription }
    }
  }

  /// A missing start acknowledgement cannot be matched conclusively to a record. Only an explicit user decision clears it.
  func acknowledgeUncertain() {
    guard uncertain, !starting else { return }
    if let recoveryRunID {
      guard let observedRunIDs else {
        error = L10n.text.copy("请先成功读取运行记录并核对状态。", "Reload run history successfully before acknowledging its state.")
        return
      }
      if !observedRunIDs.contains(recoveryRunID) {
        run = nil
        terminalOutput = ""
        outputOrderKnown = true
        terminalSession.discard()
      }
    }
    uncertain = false
    recoveryRunID = nil
    recoveryScope = nil
    error = nil
    stale = true
    updateTerminalSession()
  }

  func openRun(_ run: ProjectCommandRun) {
    guard !starting, !busy || self.run?.id == run.id else { return }
    if busy, self.run?.id == run.id { return }
    liveRunID = nil
    self.run = run
    terminalOutput = run.stdout + run.stderr
    outputOrderKnown = run.stderr.isEmpty
    updateTerminalSession()
  }

  func cancelRun() async {
    guard let client, let run, run.isRunning, !starting, !stopping else { return }
    let session = connection
    stopping = true
    defer { if session == connection { stopping = false } }
    do {
      let value = try await client.cancelProjectCommandRun(run.id)
      guard session == connection, self.run?.id == run.id else { return }
      self.run = value
      updateTerminalSession()
      remember(value)
      uncertain = false
    } catch {
      guard session == connection else { return }
      uncertain = true
      terminalSession.suspendInput()
      recoveryRunID = run.id
      self.error = L10n.text.copy(
        "停止结果尚未确认，请重新读取运行记录。", "The stop outcome is unknown. Reload run history.")
      await refreshRuns()
    }
  }

  func writeInput(_ data: String) async {
    await writeInput(Data(data.utf8))
  }

  func writeInput(_ data: Data) async {
    guard let run else { return }
    await enqueueInput(data, runID: run.id, session: connection)?.value
  }

  /// Bind before scheduling so detached-view callbacks cannot target a replacement runtime or selected run.
  func terminalInputHandler(for runID: String) -> (Data) -> Void {
    let session = connection
    return { [weak self] data in _ = self?.enqueueInput(data, runID: runID, session: session) }
  }

  func terminalResizeHandler(for runID: String) -> (Int, Int) -> Void {
    let session = connection
    return { [weak self] columns, rows in
      Task {
        guard let self, self.connection == session, self.run?.id == runID else { return }
        await self.resize(columns: columns, rows: rows)
      }
    }
  }

  private func enqueueInput(_ data: Data, runID: String, session: UUID) -> Task<Void, Never>? {
    guard session == connection, run?.id == runID, client != nil, run?.isRunning == true,
      !uncertain, !inputUncertain, !data.isEmpty
    else { return nil }
    guard data.count <= 64 * 1024, queuedInputBytes + data.count <= 256 * 1024 else {
      error = L10n.text.copy("终端输入队列已满，请等待后重试。", "The terminal input queue is full. Wait before trying again.")
      return nil
    }
    inputQueue.append((runID, data))
    queuedInputBytes += data.count
    if inputTask == nil {
      let session = connection
      inputTask = Task { await drainInput(session: session) }
    }
    return inputTask
  }

  func acknowledgeInputDelivery() {
    guard inputUncertain else { return }
    inputUncertain = false
    error = nil
    updateTerminalSession()
  }

  private func drainInput(session: UUID) async {
    defer { if session == connection { inputTask = nil } }
    while !inputQueue.isEmpty, session == connection, !Task.isCancelled, let client {
      let next = inputQueue.removeFirst()
      defer { if session == connection { queuedInputBytes -= next.data.count } }
      do { try await client.writeProjectCommandRun(next.runID, bytes: next.data) } catch {
        guard session == connection else { return }
        inputQueue = []
        queuedInputBytes = next.data.count
        inputUncertain = !Self.isDefiniteRejection(error)
        updateTerminalSession()
        self.error = L10n.text.copy(
          "无法确认输入是否已送达，后续排队内容已取消。请检查终端输出，再确认继续输入。",
          "Input delivery could not be confirmed; queued input was cancelled. Check terminal output before resuming.")
        return
      }
    }
  }

  func resize(columns: Int, rows: Int) async {
    guard let client, let run, run.isRunning else { return }
    try? await client.resizeProjectCommandRun(run.id, columns: columns, rows: rows)
  }

  private func remember(_ value: ProjectCommandRun) {
    guard value.projectId == projectID, value.capabilityId == capabilityID else { return }
    history.removeAll { $0.id == value.id }
    history.insert(value, at: 0)
  }
  private func updateTerminalSession(appendedOutput: String? = nil) {
    guard let run else { return }
    terminalSession.update(
      runID: run.id, output: terminalOutput, appendedOutput: appendedOutput,
      running: run.isRunning && !uncertain && !inputUncertain,
      liveOutput: terminalOutputIsLive,
      sendInput: terminalInputHandler(for: run.id), resize: terminalResizeHandler(for: run.id))
  }
  private func appendTerminal(_ chunk: String) {
    terminalOutput = String((terminalOutput + chunk).suffix(outputLimit))
  }
  private static func isConflict(_ error: Error) -> Bool {
    if case RuntimeAPIError.rejected(409, _) = error { return true }
    return false
  }
  private static func isDefiniteRejection(_ error: Error) -> Bool {
    if case RuntimeAPIError.rejected(let status, _) = error { return (400..<500).contains(status) }
    return false
  }
}
