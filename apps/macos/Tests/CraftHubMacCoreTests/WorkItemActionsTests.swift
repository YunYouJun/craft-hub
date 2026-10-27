import Foundation
import Testing

@testable import CraftHubMacCore

@Test func workItemActionTargetsPreserveNativeIdentityAndNestedRequiredFields() throws {
  let json = #"""
    {"integrationId":"tasks","item":{"key":"display-key","id":"display-id","title":"Review proposal","active":true,"personal":true,
    "sourceRef":{"providerId":"tasks","instanceId":"personal","accountId":"account","containerId":"inbox","kind":"task","itemId":"native-id"},
    "metadata":{"workspaceId":"space","itemId":"incorrect"}}}
    """#
  let target = try JSONDecoder().decode(WorkItemActionTarget.self, from: Data(json.utf8))
  #expect(target.projectId == nil && !target.readOnly && target.connectionInput.isEmpty)
  #expect(target.item.workItemInput["itemId"] == .string("native-id"))
  #expect(target.item.workItemInput["workspaceId"] == .string("space"))
  #expect(target.item.workItemInput["sourceRef"] == target.item.sourceRef?.input)
  let nested: IntegrationValue = .object([
    "fields": .object(["owner": .string("alex")]), "values": .array([.bool(true), .null]),
  ])
  #expect(try JSONDecoder().decode(IntegrationValue.self, from: JSONEncoder().encode(nested)) == nested)
  let another = try JSONDecoder().decode(
    WorkItemActionTarget.self, from: Data(json.replacingOccurrences(of: "\"inbox\"", with: "\"other-inbox\"").utf8))
  #expect(!target.item.refersToSameWorkItem(as: another.item))
}

@Test func workItemDescriptionsRemainInertTextAndOmitExecutableAndHiddenMarkup() {
  let html = #"""
    <p>Review &amp; verify</p><script src="https://example.com/code.js">hidden()</script>
    <style>.secret { color: red }</style><template>hidden template</template>
    <p>Second &#x1F44D; line<br>final&nbsp;line<img src="https://example.com/image.png"></p>
    <iframe>hidden frame</iframe><!-- hidden comment -->
    """#
  let plain = WorkItemText.plainDescription(html)
  #expect(plain.contains("Review & verify") && plain.contains("Second 👍 line\nfinal line"))
  #expect(!plain.contains("hidden") && !plain.contains("secret") && !plain.contains("https://"))
  #expect(WorkItemText.plainDescription("Visible<script>unclosed content") == "Visible")
  #expect(
    WorkItemText.plainDescription("&lt;script&gt;displayed as text&lt;/script&gt;")
      == "<script>displayed as text</script>")
}

@Test func sparseStatusReceiptsKeepScopeAndRemoveAnObsoleteStatusLabel() throws {
  func entity(_ value: String) throws -> IntegrationPresentation.Entity {
    try JSONDecoder().decode(IntegrationPresentation.Entity.self, from: Data(value.utf8))
  }
  let original = try entity(
    #"{"id":"1","key":"account/space/1","title":"Review","active":true,"personal":true,"status":"active","statusLabel":"In progress","statusCategory":"active","statusUpdateAvailable":true,"metadata":{"workspaceId":"space"}}"#
  )
  let receipt = try entity(
    #"{"id":"1","key":"legacy/1","title":"Review","active":false,"personal":false,"status":"done"}"#)
  let merged = original.merging(receipt)
  #expect(merged.key == original.key && merged.personal && merged.metadata == original.metadata)
  #expect(merged.status == "done" && merged.statusLabel == nil && merged.statusCategory == nil && !merged.active)
  #expect(original.refersToSameWorkItem(as: receipt))
}
