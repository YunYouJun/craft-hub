import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private func projectConnection() throws -> RuntimeConnection {
  let secret = String(repeating: "a", count: 64)
  return try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
      "nativeApiToken": secret,
    ]))
}

private actor ProjectFixture {
  var requests: [String] = []
  var paths: [String] = []
  var reads = 0
  var held = false
  var continuation: CheckedContinuation<Void, Never>?
  func hold() { held = true }
  func release() {
    continuation?.resume()
    continuation = nil
    held = false
  }
  func receive(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append("\(request.httpMethod ?? "GET") \(request.url!.path)")
    let response: [String: Any]
    var status = 200
    if request.httpMethod == "POST" {
      let input = try JSONDecoder().decode([String: String].self, from: request.httpBody!)
      #expect(Set(input.keys) == ["path"])
      let path = input["path"]!
      if path == "/broken" {
        response = ["error": "Folder is unavailable"]
        status = 400
      } else {
        paths.append(path)
        response = project(path)
        status = 201
      }
    } else {
      reads += 1
      if held { await withCheckedContinuation { continuation = $0 } }
      response = ["projects": paths.map(project), "diagnostics": []]
    }
    return (
      try JSONSerialization.data(withJSONObject: response),
      HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    )
  }
  private func project(_ path: String) -> [String: String] {
    ["id": path, "path": path, "name": URL(fileURLWithPath: path).lastPathComponent, "trust": "untrusted"]
  }
}

@MainActor @Test func nativeProjectRegistrationDeduplicatesFoldersAndRetainsPartialSuccessWithoutGrantingTrust()
  async throws
{
  let fixture = ProjectFixture()
  let model = ProjectsModel()
  model.connect(RuntimeAPIClient(connection: try projectConnection(), transport: { try await fixture.receive($0) }))
  await model.add([
    URL(fileURLWithPath: "/project one"), URL(fileURLWithPath: "/project one"), URL(fileURLWithPath: "/broken"),
  ])
  #expect(model.projects.map(\.path) == ["/project one"])
  #expect(model.projects.allSatisfy { $0.trust == "untrusted" })
  #expect(model.error?.contains("Folder is unavailable") == true)
  #expect(model.selectedID == "/project one")
  #expect(await fixture.requests == ["POST /api/projects", "POST /api/projects", "GET /api/projects"])
  model.search = "PROJECT ONE"
  #expect(model.filtered.count == 1)
  model.search = "missing"
  #expect(model.filtered.isEmpty)
  model.connect(nil)
  #expect(model.projects.isEmpty && model.search == "missing")
}

@MainActor @Test func projectChangesDuringALoadCauseASecondReadAndUnrelatedEventsDoNotReload() async throws {
  let fixture = ProjectFixture()
  await fixture.hold()
  let model = ProjectsModel()
  model.connect(RuntimeAPIClient(connection: try projectConnection(), transport: { try await fixture.receive($0) }))
  let loading = Task { await model.load() }
  for _ in 0..<100 {
    if await fixture.reads > 0 { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  model.invalidate([.projectCatalog])
  await fixture.release()
  await loading.value
  #expect(await fixture.reads == 2)
  model.invalidate([.runs, .softwareSources])
  await model.load()
  #expect(await fixture.reads == 2)
  await fixture.hold()
  let old = Task { await model.load(force: true) }
  for _ in 0..<100 {
    if await fixture.reads == 3 { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  model.connect(nil)
  await fixture.release()
  await old.value
  #expect(model.projects.isEmpty && !model.loading)
}
