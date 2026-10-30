import CraftHubMacCore
import Foundation
import SwiftTerm
import Testing

@testable import CraftHubMac

private actor CommandModelFixture {
  var paths: [String] = []
  var bodies: [[String: Any]] = []
  var generation = 1
  var release = false
  var rejectRun = false
  var loseStream = false
  var loseBeforeStart = false
  var runWasAccepted = false
  var trusted = false
  var loseTrust = false
  var inputMessages: [String] = []
  var rawInputMessages: [Data] = []
  var holdInput = false
  var inputHolding = false
  var inputFailure = false
  var inputContinuation: CheckedContinuation<Void, Never>?
  var holdStop = false
  var stopHolding = false
  var stopContinuation: CheckedContinuation<Void, Never>?
  var holdPreview = false
  var previewHolding = false
  var previewContinuation: CheckedContinuation<Void, Never>?
  var storedOutput = "你好\r\n"
  var streamChunks: [String]?
  func changeDeclaration() { generation += 1 }
  func markRelease() { release = true }
  func conflictRun() { rejectRun = true }
  func disconnect(afterStart: Bool) {
    loseStream = afterStart
    loseBeforeStart = !afterStart
  }
  func disconnectTrust() { loseTrust = true }
  func reportRunningRun(output: String = "你好\r\n") {
    runWasAccepted = true
    loseStream = true
    storedOutput = output
  }
  func configureStream(_ chunks: [String]) { streamChunks = chunks }
  func pauseInput(fail: Bool = false) {
    holdInput = true
    inputFailure = fail
  }
  func resumeInput() {
    inputContinuation?.resume()
    inputContinuation = nil
  }
  func pauseStop() { holdStop = true }
  func pausePreview() { holdPreview = true }
  func resumePreview() {
    previewContinuation?.resume()
    previewContinuation = nil
  }
  func resumeStop() {
    stopContinuation?.resume()
    stopContinuation = nil
  }
  func runningRecord(id: String = "run-one") throws -> ProjectCommandRun {
    var value = run("running")
    value["id"] = id
    return try JSONDecoder().decode(ProjectCommandRun.self, from: JSONSerialization.data(withJSONObject: value))
  }
  func receive(_ request: URLRequest) async throws -> (Data, URLResponse) {
    let path = request.url!.path
    paths.append(path)
    let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    bodies.append(body)
    var status = 200
    var contentType = "application/json"
    let value: Any
    if path == "/api/projects" {
      value = ["projects": [project()], "diagnostics": []]
    } else if path.hasSuffix("/capability-discovery") {
      value = ["capabilities": [command()], "packages": [], "diagnostics": []]
    } else if path.hasSuffix("/preview-command") {
      let inputs = body["inputs"] as? [String: String] ?? [:]
      if inputs["name"] == "invalid" {
        status = 400
        value = ["error": "Invalid name input"]
      } else {
        var resolved = invocation()
        if inputs["mode"] == "custom" {
          resolved["args"] = ["--generation", "\(generation)", "--name", inputs["name"] ?? ""]
        }
        value = resolved
      }
      if holdPreview {
        holdPreview = false
        previewHolding = true
        await withCheckedContinuation { previewContinuation = $0 }
        previewHolding = false
      }
    } else if path.hasSuffix("/command-review") {
      value = [
        "reviewId": "review-\(generation)", "project": project(), "capability": command(),
        "invocation": invocation(), "expiresAt": "2026-10-29T00:05:00.000Z",
      ]
    } else if path.hasSuffix("/trust") {
      if body["reviewId"] as? String != "review-\(generation)" {
        status = 409
        value = ["error": "Command changed; review again"]
      } else {
        trusted = true
        if loseTrust {
          loseTrust = false
          throw URLError(.networkConnectionLost)
        }
        value = project()
      }
    } else if path.hasSuffix("/run") {
      if rejectRun || body["reviewId"] as? String != "review-\(generation)" {
        status = 409
        value = ["error": "Command changed; review again"]
      } else {
        runWasAccepted = true
        if loseBeforeStart { throw URLError(.networkConnectionLost) }
        contentType = "application/x-ndjson"
        var initial = run("running")
        initial["stdout"] = ""
        initial["stderr"] = ""
        var data = try line(["type": "start", "run": initial])
        if let streamChunks {
          for chunk in streamChunks { data.append(try line(["type": "output", "stream": "stdout", "chunk": chunk])) }
        } else {
          data.append(try line(["type": "output", "stream": "stdout", "chunk": "你好\r\n"]))
          data.append(try line(["type": "output", "stream": "stderr", "chunk": "warning\n"]))
        }
        if !loseStream { data.append(try line(["type": "complete", "run": run("completed")])) }
        return (
          data,
          HTTPURLResponse(
            url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": contentType])!
        )
      }
    } else if path == "/api/runs" {
      value = runWasAccepted ? [run(loseStream ? "running" : "completed")] : []
    } else if path.hasSuffix("/input") {
      let bytes =
        (body["data"] as? String).map { Data($0.utf8) }
        ?? (body["dataBase64"] as? String).flatMap { Data(base64Encoded: $0) } ?? Data()
      rawInputMessages.append(bytes)
      inputMessages.append(String(decoding: bytes, as: UTF8.self))
      if holdInput {
        holdInput = false
        inputHolding = true
        await withCheckedContinuation { inputContinuation = $0 }
        inputHolding = false
      }
      if inputFailure {
        inputFailure = false
        throw URLError(.networkConnectionLost)
      }
      value = ["accepted": true]
    } else if path == "/api/runs/run-one", request.httpMethod == "DELETE" {
      if holdStop {
        holdStop = false
        stopHolding = true
        await withCheckedContinuation { stopContinuation = $0 }
        stopHolding = false
      }
      value = run("cancelled")
    } else {
      value = ["cancelled": true]
    }
    return (
      try JSONSerialization.data(withJSONObject: value),
      HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": contentType])!
    )
  }
  private func project() -> [String: Any] {
    ["id": "fixture", "name": "Fixture", "path": "/fixture", "trust": trusted ? "trusted" : "untrusted"]
  }
  private func invocation() -> [String: Any] {
    ["command": "fixture", "args": ["--generation", "\(generation)"], "cwd": "/fixture", "requiredEnv": []]
  }
  private func command() -> [String: Any] {
    var value: [String: Any] = [
      "id": "build", "kind": "command", "name": "Build", "source": "fixture", "invocation": invocation(),
      "inputs": [
        [
          "id": "mode", "type": "select", "default": "default", "options": [["value": "default"], ["value": "custom"]],
        ],
        ["id": "name", "type": "text", "visibleWhen": ["input": "mode", "equals": "custom"], "private": true],
      ],
    ]
    if release { value["operation"] = ["kind": "release", "requiresCleanGit": true] }
    return value
  }
  private func run(_ status: String) -> [String: Any] {
    [
      "id": "run-one", "projectId": "fixture", "capabilityId": "build", "command": "fixture", "args": [],
      "cwd": "/fixture", "startedAt": "2026-10-29T00:00:00Z", "stdout": storedOutput, "stderr": "warning\n",
      "status": status,
    ]
  }
  private func line(_ value: [String: Any]) throws -> Data {
    var result = try JSONSerialization.data(withJSONObject: value)
    result.append(0x0a)
    return result
  }
}

private func commandModelClient(_ fixture: CommandModelFixture) throws -> RuntimeAPIClient {
  let secret = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
      "nativeApiToken": secret,
    ]))
  return RuntimeAPIClient(connection: connection, transport: { try await fixture.receive($0) })
}

@MainActor @Test func nativeCommandInspectionAndCancelledReviewsNeverTrustOrExecute() async throws {
  let fixture = CommandModelFixture()
  let model = ProjectCommandModel()
  model.connect(try commandModelClient(fixture))
  model.select(project: "fixture", capability: "build")
  await model.load()
  #expect(model.canPrepare && model.visibleInputs.map(\.id) == ["mode"])
  model.editInput("mode", value: "custom")
  #expect(model.visibleInputs.map(\.id) == ["mode", "name"])
  await model.prepareReview()
  #expect(model.review?.requiresTrust == true)
  model.editInput("name", value: "draft")
  #expect(model.review == nil)
  await model.confirmReview()
  let paths = await fixture.paths
  #expect(!paths.contains(where: { $0.hasSuffix("/trust") || $0.hasSuffix("/run") }))
  #expect(await fixture.trusted == false)
}

@MainActor @Test func nativeCommandTrustAndRunRequireFrozenRuntimeReviewAndKeepOutputAcrossNavigation() async throws {
  let fixture = CommandModelFixture()
  let model = ProjectCommandModel()
  model.connect(try commandModelClient(fixture))
  model.select(project: "fixture", capability: "build")
  await model.load()
  await model.prepareReview()
  await model.confirmReview()
  #expect(model.run?.status == "completed" && !model.uncertain && !model.busy)
  #expect(model.terminalOutput == "你好\r\nwarning\n")
  #expect(model.review == nil && model.history.count == 1)
  #expect(await fixture.trusted)
  let paths = await fixture.paths
  #expect(paths.firstIndex(of: "/api/projects/fixture/trust")! < paths.firstIndex(of: "/api/projects/fixture/run")!)
  let output = model.terminalOutput
  model.close()
  #expect(model.run?.id == "run-one" && model.terminalOutput == output)
}

@MainActor @Test func changedCommandsCannotReceiveTrustFromAnEarlierReview() async throws {
  let fixture = CommandModelFixture()
  let model = ProjectCommandModel()
  model.connect(try commandModelClient(fixture))
  model.select(project: "fixture", capability: "build")
  await model.load()
  await model.prepareReview()
  await fixture.changeDeclaration()
  await model.confirmReview()
  #expect(model.stale && model.run == nil && !model.uncertain)
  #expect(await fixture.trusted == false)
  #expect(await fixture.runWasAccepted == false)
  await model.load(force: true)
  #expect(model.invocation?.args == ["--generation", "2"])
}

@MainActor @Test func knownDisconnectedRunIsRecoveredButUnknownStartupRequiresExplicitHistoryReview() async throws {
  for afterStart in [true, false] {
    let fixture = CommandModelFixture()
    await fixture.disconnect(afterStart: afterStart)
    let model = ProjectCommandModel()
    model.connect(try commandModelClient(fixture))
    model.select(project: "fixture", capability: "build")
    await model.load()
    await model.prepareReview()
    await model.confirmReview()
    #expect(await fixture.runWasAccepted)
    #expect(model.history.count == 1)
    if afterStart {
      #expect(model.run?.isRunning == true && !model.uncertain)
    } else {
      #expect(model.uncertain && !model.canPrepare && !model.canChangeContext)
      model.acknowledgeUncertain()
      #expect(!model.uncertain && model.stale)
    }
    let paths = await fixture.paths
    #expect(paths.filter { $0.hasSuffix("/run") }.count == 1)
  }
}

@MainActor @Test func releaseCommandsKeepTheExistingFullReleaseReviewInsteadOfNativeGenericExecution() async throws {
  let fixture = CommandModelFixture()
  await fixture.markRelease()
  let model = ProjectCommandModel()
  model.connect(try commandModelClient(fixture))
  model.select(project: "fixture", capability: "build")
  await model.load()
  #expect(model.releaseFallback && !model.canPrepare)
  await model.prepareReview()
  #expect(await fixture.paths.allSatisfy { !$0.hasSuffix("/command-review") && !$0.hasSuffix("/run") })
}

private func awaitCommandFixture(_ condition: () async -> Bool) async throws {
  for _ in 0..<200 {
    if await condition() { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("Command fixture did not reach its expected operation")
}

@MainActor @Test func uncertainTrustIsReadBackAndCannotExecuteUntilASeparateReview() async throws {
  let fixture = CommandModelFixture()
  await fixture.disconnectTrust()
  let model = ProjectCommandModel()
  model.connect(try commandModelClient(fixture))
  model.select(project: "fixture", capability: "build")
  await model.load()
  await model.prepareReview()
  await model.confirmReview()
  #expect(model.uncertain && !model.canPrepare && !model.canChangeContext)
  #expect(model.details?.project.trust == "trusted")
  #expect(await fixture.runWasAccepted == false)
  model.acknowledgeUncertain()
  await model.load(force: true)
  await model.prepareReview()
  #expect(model.review?.requiresTrust == false)
  await model.confirmReview()
  #expect(model.run?.status == "completed")
  #expect(await fixture.paths.filter { $0.hasSuffix("/trust") }.count == 1)
}

@MainActor @Test func nativeTerminalInputIsSerializedAndUnknownDeliveryDropsQueuedKeysUntilAcknowledged() async throws {
  for failure in [false, true] {
    let fixture = CommandModelFixture()
    let model = ProjectCommandModel()
    model.connect(try commandModelClient(fixture))
    model.openRun(try await fixture.runningRecord())
    await fixture.pauseInput(fail: failure)
    let first = Task { await model.writeInput("first") }
    try await awaitCommandFixture { await fixture.inputHolding }
    let second = Task { await model.writeInput("second") }
    await Task.yield()
    #expect(await fixture.inputMessages == ["first"])
    await fixture.resumeInput()
    await first.value
    await second.value
    if failure {
      #expect(model.inputUncertain)
      await model.writeInput("third")
      #expect(await fixture.inputMessages == ["first"])
      model.acknowledgeInputDelivery()
      await model.writeInput("fourth")
      #expect(await fixture.inputMessages == ["first", "fourth"])
    } else {
      #expect(await fixture.inputMessages == ["first", "second"])
      #expect(!model.inputUncertain)
    }
  }
}

@MainActor @Test func nativeRunStopCannotBeSubmittedTwiceWhileAResultIsPending() async throws {
  let fixture = CommandModelFixture()
  let model = ProjectCommandModel()
  model.connect(try commandModelClient(fixture))
  model.openRun(try await fixture.runningRecord())
  await fixture.pauseStop()
  let first = Task { await model.cancelRun() }
  try await awaitCommandFixture { await fixture.stopHolding }
  #expect(model.stopping && !model.canChangeContext)
  await model.cancelRun()
  await fixture.resumeStop()
  await first.value
  #expect(model.run?.status == "cancelled" && !model.stopping)
  #expect(await fixture.paths.filter { $0 == "/api/runs/run-one" }.count == 1)
}

@MainActor @Test func queuedTerminalCallbacksCannotCrossAConnectionGenerationEvenWhenTheRunIDMatches() async throws {
  let old = CommandModelFixture()
  let model = ProjectCommandModel()
  model.connect(try commandModelClient(old))
  model.openRun(try await old.runningRecord())
  let oldInput = model.terminalInputHandler(for: "run-one")
  let oldResize = model.terminalResizeHandler(for: "run-one")
  let replacement = CommandModelFixture()
  await replacement.reportRunningRun()
  // Enqueue synchronously, then replace the connection before its worker can start.
  oldInput(Data("old-before".utf8))
  oldResize(991, 997)
  model.connect(try commandModelClient(replacement))
  await model.load()
  #expect(model.run?.id == "run-one" && !model.uncertain)
  oldInput(Data("old-after".utf8))
  oldResize(983, 991)
  await Task.yield()
  #expect(await replacement.rawInputMessages.isEmpty)
  let freshInput = model.terminalInputHandler(for: "run-one")
  freshInput(Data("fresh".utf8))
  try await awaitCommandFixture { await replacement.rawInputMessages.count == 1 }
  #expect(await replacement.rawInputMessages == [Data("fresh".utf8)])
  let requests = await replacement.paths
  let bodies = await replacement.bodies
  #expect(
    zip(requests, bodies).allSatisfy {
      !$0.0.hasSuffix("/resize") || ![991, 983].contains($0.1["columns"] as? Int ?? 0)
    })
}

@MainActor @Test func terminalCallbacksRemainBoundToTheRunThatCreatedThemWithinTheSameConnection() async throws {
  let fixture = CommandModelFixture()
  let model = ProjectCommandModel()
  model.connect(try commandModelClient(fixture))
  model.openRun(try await fixture.runningRecord())
  let oldInput = model.terminalInputHandler(for: "run-one")
  model.openRun(try await fixture.runningRecord(id: "run-two"))
  oldInput(Data("wrong-run".utf8))
  let freshInput = model.terminalInputHandler(for: "run-two")
  freshInput(Data("right-run".utf8))
  try await awaitCommandFixture { await fixture.rawInputMessages.count == 1 }
  #expect(await fixture.rawInputMessages == [Data("right-run".utf8)])
  #expect(await fixture.paths.contains("/api/runs/run-two/input"))
  #expect(await fixture.paths.allSatisfy { $0 != "/api/runs/run-one/input" })
}

@MainActor @Test func rollingCopyOutputNeverResetsTheLiveEmulatorAtCompletionOrHistoryRefresh() async throws {
  let fixture = CommandModelFixture()
  await fixture.configureStream(["START\r\n", "one\r\n", "two\r\n", "three\r\n", "four\r\n", "five\r\n"])
  let model = ProjectCommandModel(outputLimit: 10)
  model.connect(try commandModelClient(fixture))
  model.select(project: "fixture", capability: "build")
  await model.load()
  await model.prepareReview()
  await model.confirmReview()
  #expect(model.terminalOutput == "four\r\nfive\r\n")
  #expect(model.run?.status == "completed" && model.terminalOutputIsLive)
  let terminal = model.terminalSession.view.getTerminal()
  #expect(terminal.getCharacter(col: 0, row: 0) == "S")
  #expect(terminal.getCharacter(col: 0, row: 1) == "o")
  #expect(terminal.getCharacter(col: 0, row: 5) == "f")
  await model.refreshRuns()
  #expect(terminal.getCharacter(col: 0, row: 0) == "S")
  #expect(model.terminalOutput == "four\r\nfive\r\n")
}

@MainActor @Test func nativeTerminalInputPreservesArbitraryProtocolBytesWithoutUTF8Replacement() async throws {
  let fixture = CommandModelFixture()
  let model = ProjectCommandModel()
  model.connect(try commandModelClient(fixture))
  model.openRun(try await fixture.runningRecord())
  let bytes = Data([0x1b, 0x5b, 0x4d, 0xff, 0x00, 0x80])
  await model.writeInput(bytes)
  #expect(await fixture.rawInputMessages == [bytes])
}

@MainActor @Test func reconnectDiscardsOldTerminalStateUntilFreshHistoryMatchesItsExactRun() async throws {
  for matched in [false, true] {
    let old = CommandModelFixture()
    let model = ProjectCommandModel()
    model.connect(try commandModelClient(old))
    model.openRun(try await old.runningRecord())
    let replacement = CommandModelFixture()
    if matched { await replacement.reportRunningRun(output: "\u{1b}[6n") }
    model.connect(try commandModelClient(replacement))
    #expect(model.run == nil && model.terminalOutput.isEmpty && !model.terminalOutputIsLive && model.uncertain)
    await model.writeInput(Data([0xff]))
    #expect(await replacement.rawInputMessages.isEmpty)
    await model.load()
    if matched {
      #expect(model.run?.id == "run-one" && !model.uncertain && !model.terminalOutputIsLive)
      // Historical terminal queries must not emit input into a fresh runtime.
      #expect(await replacement.rawInputMessages.isEmpty)
    } else {
      #expect(model.run == nil && model.uncertain)
      model.acknowledgeUncertain()
      await model.load(force: true)
      #expect(model.run == nil && !model.uncertain && model.canPrepare)
    }
  }
}

@MainActor @Test func editedCommandInputsHideOldArgvAndRejectLatePreviewResultsAndErrors() async throws {
  let fixture = CommandModelFixture()
  let model = ProjectCommandModel()
  model.connect(try commandModelClient(fixture))
  model.select(project: "fixture", capability: "build")
  await model.load()
  #expect(model.invocation?.args == ["--generation", "1"])
  await fixture.pausePreview()
  model.editInput("mode", value: "custom")
  model.editInput("name", value: "old")
  #expect(model.invocation == nil && model.previewing)
  try await awaitCommandFixture { await fixture.previewHolding }
  model.editInput("name", value: "new")
  try await awaitCommandFixture { await !model.previewing }
  #expect(model.invocation?.args == ["--generation", "1", "--name", "new"])
  await fixture.resumePreview()
  await Task.yield()
  #expect(model.invocation?.args.last == "new" && model.previewError == nil)
  model.editInput("name", value: "invalid")
  #expect(model.invocation == nil)
  try await awaitCommandFixture { await !model.previewing }
  #expect(model.invocation == nil && model.previewError?.contains("Invalid name input") == true)
}
