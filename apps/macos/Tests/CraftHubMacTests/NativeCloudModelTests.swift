import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private let cloudJSON = #"{"version":1,"status":{"state":"connected","deviceId":"fixture"},"approvals":[]}"#
private func cloudConnection() throws -> RuntimeConnection {
  let token = String(repeating: "a", count: 64)
  return try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
}

@MainActor @Test func nativeCloudCallbacksUseOnlyTheNativeEndpointAndNoWebInbox() async throws {
  var requests: [URLRequest] = []
  let model = WorkbenchModel()
  model.cloud.connect(
    RuntimeAPIClient(connection: try cloudConnection()) { request in
      requests.append(request)
      return (
        Data(cloudJSON.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
      )
    }, pollAutomatically: false)
  await model.cloud.adopt(URL(string: "craft-hub-native://cloud/connect?code=fixture&challenge=fixture")!)
  let request = try #require(requests.first)
  #expect(request.url?.path == "/api/native-host/cloud" && request.httpMethod == "POST")
  #expect(request.url?.query == nil && request.value(forHTTPHeaderField: "Cookie") == nil)
  #expect(model.cloud.snapshot?.status.deviceId == "fixture")
  await model.cloud.adopt(URL(string: "craft-hub://cloud/connect?code=fixture")!)
  #expect(requests.count == 1 && model.cloud.error != nil)
  model.cloud.connect(nil)
}

@MainActor @Test func lateCloudMutationCannotRestoreAnOldAccountAfterDisconnect() async throws {
  var continuation: CheckedContinuation<Void, Never>?
  let model = NativeCloudModel()
  model.connect(
    RuntimeAPIClient(connection: try cloudConnection()) { request in
      await withCheckedContinuation { continuation = $0 }
      return (
        Data(cloudJSON.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
      )
    }, pollAutomatically: false)
  let action = Task { await model.perform("connect") }
  for _ in 0..<100 {
    if continuation != nil { break }
    await Task.yield()
  }
  #expect(model.busy)
  model.connect(nil)
  continuation?.resume()
  await action.value
  #expect(model.snapshot == nil && !model.available && !model.busy)
}

@MainActor @Test func cloudCallbackWaitsForTheConnectionActionAndOldPollsCannotOverwriteIt() async throws {
  var connectWaiter: CheckedContinuation<Void, Never>?
  var pollWaiter: CheckedContinuation<Void, Never>?
  var actions: [String] = []
  let model = NativeCloudModel()
  model.connect(
    RuntimeAPIClient(connection: try cloudConnection()) { request in
      let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
      if request.httpMethod == "GET" {
        await withCheckedContinuation { pollWaiter = $0 }
        return (Data(#"{"version":1,"status":{"state":"disconnected"},"approvals":[]}"#.utf8), response)
      }
      let input = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
      let action = input["action"] as! String
      actions.append(action)
      if action == "connect" { await withCheckedContinuation { connectWaiter = $0 } }
      return (Data(cloudJSON.utf8), response)
    }, pollAutomatically: false)
  let read = Task { await model.refresh() }
  for _ in 0..<100 {
    if pollWaiter != nil { break }
    await Task.yield()
  }
  let connect = Task { await model.perform("connect") }
  for _ in 0..<100 {
    if connectWaiter != nil { break }
    await Task.yield()
  }
  let callback = Task {
    await model.adopt(URL(string: "craft-hub-native://cloud/connect?code=fixture&challenge=fixture")!)
  }
  await Task.yield()
  #expect(actions == ["connect"])
  connectWaiter?.resume()
  await connect.value
  await callback.value
  pollWaiter?.resume()
  await read.value
  #expect(actions == ["connect", "callback"] && model.snapshot?.status.state == "connected")
  model.connect(nil)
}
