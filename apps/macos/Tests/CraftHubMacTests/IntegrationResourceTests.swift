import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private let resourceCatalog = #"""
  {"integrations":[{"id":"fixture","actions":[
  {"id":"read","title":"Read","operation":"resources.read","effect":"remote-read","effectiveConfirmation":"never"},
  {"id":"write","title":"Write","operation":"resources.update","effect":"local-write","effectiveConfirmation":"always"},
  {"id":"connection","title":"Connection","operation":"connection.status","effect":"remote-read","effectiveConfirmation":"never"}],
  "views":[{"id":"resources","title":"Resources","scope":"global-and-project","blocks":[
  {"id":"connection","type":"connection-status","actionId":"connection"},
  {"id":"resources","type":"resource-browser","actionId":"read","input":{"resource":"home"}},
  {"id":"wrong","type":"resource-browser","actionId":"write"}]}]}],"diagnostics":[]}
  """#

private actor ResourceFixture {
  var requests: [URLRequest] = []
  var account = "first"
  var fail = false
  var hold = false
  var waiter: CheckedContinuation<Void, Never>?
  func configure(account: String = "first", fail: Bool = false, hold: Bool = false) {
    self.account = account
    self.fail = fail
    self.hold = hold
  }
  func release() {
    waiter?.resume()
    waiter = nil
    hold = false
  }
  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    if request.url!.lastPathComponent == "integrations" { return (Data(resourceCatalog.utf8), response) }
    let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
    let input = body["input"] as? [String: Any] ?? [:]
    let resource = input["resource"] as? String ?? "home"
    let json: [String: Any]
    if request.url!.lastPathComponent == "connection" {
      json = ["version": 1, "kind": "connection", "connection": ["connected": true, "session": ["cacheKey": account]]]
    } else {
      json = [
        "version": 1, "kind": "resources",
        "resources": [
          "title": "\(account)/\(resource)", "input": ["resource": resource],
          "links": [["title": "Project resource", "input": ["resource": "child"], "projectId": "linked-project"]],
          "documents": [
            [
              "id": "readme", "title": "README", "content": "<script>inert</script>", "compareWith": "old",
              "filename": "../README.md",
            ]
          ],
          "forms": [["id": "save", "title": "Save", "effect": "update"]],
        ],
      ]
      if hold { await withCheckedContinuation { waiter = $0 } }
      if fail { throw URLError(.timedOut) }
    }
    return (try JSONSerialization.data(withJSONObject: json), response)
  }
}

@MainActor private func resourceModel(_ fixture: ResourceFixture) async throws -> IntegrationWorkbenchModel {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  let model = IntegrationWorkbenchModel()
  model.connect(RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) }))
  await model.loadCatalog()
  return model
}

private func waitForResource(_ fixture: ResourceFixture) async throws {
  for _ in 0..<100 {
    if await fixture.waiter != nil { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("Resource request was not held")
}

@MainActor @Test func resourcesRemainReadOnlyAndRetainProjectScopeAcrossNavigationRefreshAndBack() async throws {
  let fixture = ResourceFixture()
  let model = try await resourceModel(fixture)
  #expect(await fixture.requests.count == 1)
  await model.select("fixture/resources", project: "root-project")
  let block = try #require(model.entry?.view.blocks.first { $0.id == "resources" })
  let wrong = try #require(model.entry?.view.blocks.first { $0.id == "wrong" })
  #expect(!model.readable(wrong))
  let state = model.state(block)
  #expect(state.resourcePage?.documents?.first?.content == "<script>inert</script>")
  #expect(state.resourcePage?.forms?.first?.effect == "update")
  await model.readResource(block, link: try #require(state.resourcePage?.links?.first))
  #expect(state.resourceLocation?.project == "linked-project" && state.resourceHistory.count == 1)
  await model.read(block)
  #expect(state.resourceLocation?.project == "linked-project" && state.resourceHistory.count == 1)
  await model.readResource(block, back: true)
  #expect(state.resourceLocation?.project == "root-project" && state.resourceHistory.isEmpty)
  #expect(state.resourcePage?.title == "first/home")
  let requests = await fixture.requests.filter { $0.url?.lastPathComponent == "read" }
  #expect(
    requests.map { $0.url!.path }
      == ["root-project", "linked-project", "linked-project", "root-project"].map {
        "/api/projects/\($0)/integrations/fixture/actions/read"
      })
  for request in requests {
    let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
    #expect(body["confirmed"] as? Bool == false)
    #expect(body["reviewedAction"] as? [String: String] == ["operation": "resources.read", "effect": "remote-read"])
  }
  #expect(await fixture.requests.allSatisfy { $0.url?.lastPathComponent != "write" })
}

@MainActor @Test func failedResourceNavigationRetainsPreviousScopeAndRequiresFreshRead() async throws {
  let fixture = ResourceFixture()
  let model = try await resourceModel(fixture)
  await model.select("fixture/resources")
  let block = try #require(model.entry?.view.blocks.first { $0.id == "resources" })
  let state = model.state(block)
  let link = try #require(state.resourcePage?.links?.first)
  await fixture.configure(fail: true)
  await model.readResource(block, link: link)
  #expect(state.stale && state.error != nil && state.resourceHistory.isEmpty)
  #expect(state.resourceLocation?.project == nil && state.resourcePage?.title == "first/home")
  let count = await fixture.requests.count
  await model.readResource(block, link: link)
  #expect(await fixture.requests.count == count)
  await fixture.configure()
  await model.read(block)
  #expect(!state.stale && state.error == nil)
  await model.readResource(block, link: link)
  await model.readResource(block, home: true)
  #expect(state.resourceLocation?.project == nil && state.resourcePage?.title == "first/home")
}

@MainActor @Test func resourceRepliesCannotOutliveAccountChangesInvalidationOrRuntimeReplacement() async throws {
  let fixture = ResourceFixture()
  let model = try await resourceModel(fixture)
  await model.select("fixture/resources")
  let block = try #require(model.entry?.view.blocks.first { $0.id == "resources" })
  let connection = try #require(model.entry?.view.blocks.first { $0.id == "connection" })
  let state = model.state(block)
  await fixture.configure(hold: true)
  let held = Task { await model.read(block) }
  try await waitForResource(fixture)
  await fixture.configure(account: "second")
  await model.read(connection)
  #expect(state.resourcePage == nil && state.resourceLocation == nil && state.resourceHistory.isEmpty)
  await fixture.release()
  await held.value
  #expect(state.resourcePage == nil)
  await model.read(block)
  #expect(state.resourcePage?.title == "second/home")
  await fixture.configure(account: "second", hold: true)
  let invalidated = Task { await model.read(block) }
  try await waitForResource(fixture)
  model.invalidate([.integrations])
  await fixture.release()
  await invalidated.value
  #expect(state.stale)
  await fixture.configure(hold: true)
  let replaced = Task { await model.read(block) }
  try await waitForResource(fixture)
  model.connect(nil)
  await fixture.release()
  await replaced.value
  #expect(model.states.isEmpty && model.entries.isEmpty)
}
