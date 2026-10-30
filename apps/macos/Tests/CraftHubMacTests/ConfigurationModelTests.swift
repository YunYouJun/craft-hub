import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private actor ConfigurationFixture {
  var requests: [URLRequest] = []
  var floor = "never"
  var writable = true
  var supported = true
  var historyAvailable = true
  var state = "applied"
  var fail = ""
  var hold = ""
  var waiter: CheckedContinuation<Void, Never>?
  private let heldRequests = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
  var registryRevision = "registry-1"
  var registryAvailable = true
  func registry(revision: String = "registry-1", available: Bool = true) {
    registryRevision = revision
    registryAvailable = available
  }
  func configure(
    floor: String = "never", writable: Bool = true, supported: Bool = true, history: Bool = true, fail: String = "",
    hold: String = ""
  ) {
    self.floor = floor
    self.writable = writable
    self.supported = supported
    historyAvailable = history
    self.fail = fail
    self.hold = hold
  }
  func release() {
    waiter?.resume()
    waiter = nil
    hold = ""
  }
  func waitUntilHeld() async throws {
    try await requireHeldResponse(heldRequests.stream) { await self.release() }
  }
  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    var json: [String: Any]
    if request.url?.path == "/api/integrations" {
      json = [
        "integrations": [
          [
            "id": "fixture",
            "actions": [
              [
                "id": "custom-read", "title": "Read", "operation": "configuration.read", "effect": "local-read",
                "effectiveConfirmation": floor,
              ],
              [
                "id": "custom-update", "title": "Update", "operation": "configuration.update", "effect": "local-write",
                "effectiveConfirmation": "always",
              ],
              [
                "id": "custom-git", "title": "Git", "operation": "configuration.execute", "effect": "remote-write",
                "effectiveConfirmation": "always",
              ],
            ],
            "views": [
              [
                "id": "environment", "title": "Configuration", "scope": "global-and-project",
                "blocks": [["id": "configuration", "type": "configuration-manager", "actionId": "custom-read"]],
              ],
              [
                "id": "project", "title": "Project", "scope": "project",
                "blocks": [["id": "project", "type": "configuration-manager", "actionId": "custom-read"]],
              ],
            ],
          ]
        ], "diagnostics": [],
      ]
    } else {
      let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
      let input = body["input"] as! [String: Any]
      let operation = input["operation"] as! String
      if operation == fail { throw URLError(.timedOut) }
      if operation == "apply" { state = "applied" }
      if operation == "restore" { state = "restored" }
      json = [
        "configuration": true,
        "items": [
          [
            "id": "shell", "title": "Shell", "kind": "terminal", "owner": "user", "origin": "private",
            "localPath": "/fixture/local", "sourcePath": "/fixture/source", "status": "conflict",
            "revision": "item-revision", "local": "redacted local", "source": "redacted source",
            "fields": ["editor", "theme"],
          ],
          [
            "id": "protected", "title": "Protected", "kind": "skill", "owner": "installer", "origin": "installer",
            "localPath": "/fixture/protected", "status": "read-only", "revision": "protected-revision", "local": "",
            "source": "", "fields": [],
          ],
        ], "presentation": ["version": 1, "writableItemIds": writable ? ["shell"] : []],
        "operationSupport": [
          "state": "available",
          "operations": Dictionary(
            uniqueKeysWithValues: [
              "inspect", "preview", "apply", "restore", "history", "git-status", "git-fetch", "git-commit",
              "git-publish", "repositories", "repositories-update", "backup-preview",
            ].map { ($0, ["supported": $0 == "inspect" || supported]) }),
        ],
        "repositories": [
          [
            "id": "repository", "root": "/fixture/source", "revision": "git-revision", "outgoing": ["commit-1"],
            "outgoingDiff": "reviewed diff", "workingDiff": "reviewed working diff",
            "paths": [["path": "shellrc", "status": "M"]],
          ]
        ],
      ]
      if registryAvailable {
        json["registry"] = [
          "version": 1, "revision": registryRevision, "ownership": [:],
          "sources": ["public", "personal", "work"].map { scope in
            [
              "id": scope, "name": scope, "root": "/fixture/\(scope)", "kind": "dotfiles", "audience": scope,
              "enabled": true,
            ] as [String: Any]
          },
          "targets": [
            [
              "id": "backup", "name": "Backup", "root": "/fixture/backup", "directory": "configuration",
              "audience": "personal", "driver": "workstation", "sourceIds": ["personal"],
              "keyEnvironment": "CRAFT_HUB_BACKUP_KEY_DEFAULT",
            ],
            [
              "id": "reserved", "name": "Reserved", "directory": "configuration", "audience": "work",
              "driver": "workstation", "sourceIds": [],
            ],
            [
              "id": "external", "name": "External", "root": "/fixture/external", "directory": "configuration",
              "audience": "work", "driver": "external", "sourceIds": [],
            ],
          ],
        ]
      }
      json["presentation"] = [
        "version": 1, "writableItemIds": writable ? ["shell"] : [],
        "backupSourceIds": ["personal": ["public", "personal"], "work": ["public", "work"]],
      ]
      if historyAvailable {
        json["history"] = [["planId": "reviewed-plan", "state": state, "paths": ["/fixture/local"]]]
      }
      if operation == "preview" || operation == "backup-preview" {
        json["preview"] = [
          "planId": "reviewed-plan",
          "changes": [
            [
              "path": "/fixture/local", "direction": "to-local", "before": "redacted local", "after": "redacted source",
              "deletion": false,
            ]
          ],
        ]
      }
      if operation == hold {
        await withCheckedContinuation {
          waiter = $0
          heldRequests.continuation.yield(())
        }
      }
    }
    return (
      try JSONSerialization.data(withJSONObject: json),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
}
@MainActor private func configurationModel(_ fixture: ConfigurationFixture) throws -> ConfigurationModel {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  return ConfigurationModel(
    client: RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) }))
}
private func lastBody(_ fixture: ConfigurationFixture) async throws -> [String: Any] {
  try JSONSerialization.jsonObject(with: #require(await fixture.requests.last?.httpBody)) as! [String: Any]
}

@MainActor @Test func nativeConfigurationDiscoveryRespectsReadConfirmationAndSharedOwnership() async throws {
  let fixture = ConfigurationFixture()
  await fixture.configure(floor: "always", writable: false)
  let model = try configurationModel(fixture)
  await model.loadCatalog()
  #expect(model.entries.count == 1)
  await model.select(model.entryID)
  #expect(await fixture.requests.map(\.httpMethod) == ["GET"])
  await model.refresh(confirmed: true)
  let body = try await lastBody(fixture)
  #expect(body["confirmed"] as? Bool == true)
  let item = try #require(model.page?.items.first)
  model.choose(item, choice: "source")
  #expect(model.choices.isEmpty && !model.canPreview)
  #expect(await fixture.requests.last?.url?.path == "/api/integrations/fixture/actions/custom-read")
  await fixture.configure(supported: false)
  await model.refresh(confirmed: true)
  model.choose(item, choice: "source")
  #expect(!model.canStage && !model.canPreview)
}

@MainActor @Test func nativeConfigurationMergesRequireEveryFieldAndApplySendsOnlyTheReviewedPlan() async throws {
  let fixture = ConfigurationFixture()
  let model = try configurationModel(fixture)
  await model.loadCatalog()
  await model.refresh()
  let item = try #require(model.page?.items.first)
  model.choose(item, choice: "merge")
  model.chooseField(item, field: "editor", value: "source")
  #expect(!model.canPreview)
  model.chooseField(item, field: "theme", value: "local")
  await model.preview()
  let previewBody = try await lastBody(fixture)
  let preview = previewBody["input"] as! [String: Any]
  let decision = try #require((preview["decisions"] as? [[String: Any]])?.first)
  #expect(decision["revision"] as? String == "item-revision")
  #expect(decision["fields"] as? [String: String] == ["editor": "source", "theme": "local"])
  #expect(previewBody["confirmed"] as? Bool == true && model.plan?.planId == "reviewed-plan")
  // The ordinary integration-change event emitted by preview cannot erase its immutable approval.
  model.invalidate()
  #expect(model.canApply)
  await model.apply()
  let apply = try await lastBody(fixture)
  #expect(apply["input"] as? [String: String] == ["operation": "apply", "planId": "reviewed-plan"])
  #expect(apply["confirmed"] as? Bool == true)
  #expect(model.plan == nil && model.section == "history")
  let count = await fixture.requests.count
  await model.apply()
  #expect(await fixture.requests.count == count)
}

@MainActor @Test func discardedOrDisconnectedConfigurationPreviewCannotRestoreApproval() async throws {
  let fixture = ConfigurationFixture()
  let model = try configurationModel(fixture)
  await model.loadCatalog()
  await model.refresh()
  let item = try #require(model.page?.items.first)
  model.choose(item, choice: "source")
  await fixture.configure(hold: "preview")
  let preview = Task { await model.preview() }
  try await fixture.waitUntilHeld()
  model.discardPlan()
  await fixture.release()
  await preview.value
  #expect(model.plan == nil && !model.canApply)
  await fixture.configure(hold: "preview")
  let old = Task { await model.preview() }
  try await fixture.waitUntilHeld()
  model.disconnect()
  await fixture.release()
  await old.value
  #expect(model.plan == nil && !model.busy && !model.canApply)
}

@MainActor @Test func uncertainConfigurationApplyRequiresFreshHistoryAndNewReviewBeforeRetry() async throws {
  let fixture = ConfigurationFixture()
  let model = try configurationModel(fixture)
  await model.loadCatalog()
  await model.refresh()
  model.choose(try #require(model.page?.items.first), choice: "source")
  await model.preview()
  await fixture.configure(fail: "apply")
  await model.apply()
  #expect(model.uncertain?.planID == "reviewed-plan" && model.plan == nil)
  let count = await fixture.requests.count
  await model.apply()
  await model.preview()
  #expect(await fixture.requests.count == count)
  await fixture.configure(history: false)
  await model.refresh()
  #expect(model.uncertain != nil)
  await fixture.configure()
  await model.refresh()
  #expect(model.uncertain == nil && model.plan == nil && model.choices.isEmpty)
  let record = try #require(model.page?.history?.first)
  await model.restore(record, entryID: "another-entry")
  #expect(await fixture.requests.last?.url?.path.hasSuffix("custom-read") == true)
  await model.restore(record, entryID: model.entryID)
  #expect(
    (try await lastBody(fixture))["input"] as? [String: String] == ["operation": "restore", "planId": "reviewed-plan"])
  #expect(model.page?.history?.first?.state == "restored")
}

@MainActor @Test func nativeConfigurationGitUsesDeclaredActionAndReviewedRepositoryRevision() async throws {
  let fixture = ConfigurationFixture()
  let model = try configurationModel(fixture)
  await model.loadCatalog()
  await model.refresh()
  var command = ConfigurationCommand(operation: "git-action")
  command.action = "commit"
  command.repository = "repository"
  command.revision = "old-revision"
  command.paths = ["shellrc"]
  command.message = "chore(config): synchronize reviewed files"
  #expect(await !model.git(command, entryID: model.entryID))
  command.revision = "git-revision"
  #expect(await model.git(command, entryID: model.entryID))
  #expect(await fixture.requests.last?.url?.path == "/api/integrations/fixture/actions/custom-git")
  let body = try await lastBody(fixture)
  let input = body["input"] as! [String: Any]
  #expect(input["revision"] as? String == "git-revision" && input["paths"] as? [String] == ["shellrc"])
  #expect(body["confirmed"] as? Bool == true)
}

@MainActor @Test func configurationApprovalIsClearedWhenProviderRegistrationChanges() async throws {
  let fixture = ConfigurationFixture()
  let model = try configurationModel(fixture)
  await model.loadCatalog()
  await model.refresh()
  model.choose(try #require(model.page?.items.first), choice: "source")
  await fixture.configure(hold: "preview")
  let pending = Task { await model.preview() }
  try await fixture.waitUntilHeld()
  model.invalidate(clearApproval: true)
  await fixture.release()
  await pending.value
  #expect(model.plan == nil && model.stale && !model.canApply)
}

@MainActor @Test func registryChangesRequireFrozenReviewAndSharedBackupScope() async throws {
  let fixture = ConfigurationFixture()
  let model = try configurationModel(fixture)
  await model.loadCatalog()
  await model.refresh()
  let before = await fixture.requests.count
  model.editRegistry(category: "target")
  let draft = try #require(model.registryDraft)
  draft.target.id = "new-backup"
  draft.target.name = "Backup"
  draft.target.sourceIds = ["public", "personal", "work"]
  model.reviewRegistryDraft()
  let review = try #require(model.registryReview)
  #expect(await fixture.requests.count == before)
  #expect(review.mutation.target?.sourceIds == ["public", "personal"])
  draft.target.name = "Changed after review"
  await model.confirmRegistry(review)
  let body = try await lastBody(fixture)
  let input = try #require(body["input"] as? [String: Any])
  let mutation = try #require(input["registry"] as? [String: Any])
  let target = try #require(mutation["target"] as? [String: Any])
  #expect(body["confirmed"] as? Bool == true && mutation["revision"] as? String == "registry-1")
  #expect(target["name"] as? String == "Backup" && target["root"] == nil)
  #expect(target["keyEnvironment"] as? String == "CRAFT_HUB_BACKUP_KEY_DEFAULT")
  #expect(Set(input.keys) == ["operation", "registry"])
  #expect(model.registryDraft == nil && model.registryReview == nil)
  let after = await fixture.requests.count
  await model.confirmRegistry(review)
  #expect(await fixture.requests.count == after)
}

@MainActor @Test func registryRefreshRetainsDraftButCannotRebaseOrReplayAnApproval() async throws {
  let fixture = ConfigurationFixture()
  let model = try configurationModel(fixture)
  await model.loadCatalog()
  await model.refresh()
  model.editRegistry(category: "source", id: "personal")
  let draft = try #require(model.registryDraft)
  draft.source.name = "Local unsaved name"
  model.reviewRegistryDraft()
  let review = try #require(model.registryReview)
  await fixture.registry(revision: "registry-2")
  await model.refresh()
  #expect(model.registryDraft === draft && draft.source.name == "Local unsaved name" && draft.revision == "registry-1")
  model.reviewRegistryDraft()
  #expect(model.registryReview == nil)
  let count = await fixture.requests.count
  await model.confirmRegistry(review)
  #expect(await fixture.requests.count == count)
  model.editRegistry(category: "source", id: "personal")
  #expect(model.registryDraft?.revision == "registry-2" && model.registryDraft?.source.name == "personal")
  model.reviewRegistryDraft()
  let fresh = try #require(model.registryReview)
  model.invalidate(clearApproval: true)
  await model.confirmRegistry(fresh)
  #expect(await fixture.requests.count == count && model.registryReview == nil)
}

@MainActor @Test func uncertainRegistryMutationRequiresRegistryReadNotJustHistory() async throws {
  let fixture = ConfigurationFixture()
  let model = try configurationModel(fixture)
  await model.loadCatalog()
  await model.refresh()
  model.editRegistry(category: "source", id: "personal")
  model.reviewRegistryDraft()
  await fixture.configure(fail: "repositories-update")
  await model.confirmRegistry(try #require(model.registryReview))
  #expect(model.uncertain?.operation == "repositories-update" && model.registryDraft != nil)
  await fixture.configure()
  await fixture.registry(available: false)
  await model.refresh()
  #expect(model.uncertain != nil && !model.canManageRegistry)
  await fixture.registry(revision: "registry-2")
  await model.refresh()
  #expect(model.uncertain == nil && model.section == "sources" && model.registryDraft?.revision == "registry-1")
}

@MainActor @Test func backupPreviewHonorsReservationOwnershipReplacementAndApplyBoundary() async throws {
  let fixture = ConfigurationFixture()
  let model = try configurationModel(fixture)
  await model.loadCatalog()
  await model.refresh()
  let targets = try #require(model.page?.registry?.targets)
  let count = await fixture.requests.count
  for target in targets.dropFirst() { await model.previewBackup(target, action: "save", replace: true) }
  #expect(await fixture.requests.count == count)
  await model.previewBackup(targets[0], action: "save")
  var input = try #require((try await lastBody(fixture))["input"] as? [String: String])
  #expect(input == ["operation": "backup-preview", "targetId": "backup", "action": "save", "revision": "registry-1"])
  #expect(model.plan != nil)
  model.discardPlan()
  await model.previewBackup(targets[0], action: "save", replace: true)
  input = try #require((try await lastBody(fixture))["input"] as? [String: String])
  #expect(input["resolution"] == "replace")
  await model.apply()
  #expect(
    (try await lastBody(fixture))["input"] as? [String: String] == ["operation": "apply", "planId": "reviewed-plan"])
  await model.refresh()
  await fixture.configure(hold: "backup-preview")
  let pending = Task { await model.previewBackup(targets[0], action: "restore", replace: true) }
  try await fixture.waitUntilHeld()
  input = try #require((try await lastBody(fixture))["input"] as? [String: String])
  #expect(input["resolution"] == nil)
  model.discardPlan()
  await fixture.release()
  await pending.value
  #expect(model.plan == nil)
}

@MainActor @Test func registryRemovalAndOwnershipAreExplicitRevisionBoundMutations() async throws {
  let fixture = ConfigurationFixture()
  let model = try configurationModel(fixture)
  await model.loadCatalog()
  await model.refresh()
  var claim = ConfigurationRegistryMutation(action: "claim", revision: "registry-1")
  claim.resource = "file:.zshrc"
  claim.sourceId = "personal"
  model.prepareRegistry(claim)
  let review = try #require(model.registryReview)
  model.discardRegistryReview()
  let count = await fixture.requests.count
  await model.confirmRegistry(review)
  #expect(await fixture.requests.count == count)
  model.prepareRegistry(claim)
  await model.confirmRegistry(try #require(model.registryReview))
  let mutation = ((try await lastBody(fixture))["input"] as? [String: Any])?["registry"] as? [String: String]
  #expect(mutation == ["action": "claim", "revision": "registry-1", "resource": "file:.zshrc", "sourceId": "personal"])
  await fixture.configure(supported: false)
  await model.refresh()
  model.prepareRegistry(claim)
  #expect(model.registryReview == nil && !model.canManageRegistry)
}
