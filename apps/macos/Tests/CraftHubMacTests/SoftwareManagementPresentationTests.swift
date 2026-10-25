import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

@Test func softwareSourceScheduleLabelsRespectLegacyDefaultLocalModeAndDailyTimeZone() {
  #expect(SoftwareManagementPresentation.refresh(nil, local: false, chinese: true) == "每 24 小时刷新")
  #expect(SoftwareManagementPresentation.refresh(.init(mode: "manual"), local: false, chinese: true) == "手动刷新")
  #expect(
    SoftwareManagementPresentation.refresh(.init(mode: "interval", intervalMinutes: 90), local: false, chinese: true)
      == "每 90 分钟刷新")
  #expect(
    SoftwareManagementPresentation.refresh(
      .init(mode: "daily", time: "09:30", timeZone: "Asia/Tokyo"), local: false, chinese: true)
      == "每天 09:30 · Asia/Tokyo")
  #expect(
    SoftwareManagementPresentation.refresh(.init(mode: "interval", intervalMinutes: 15), local: true, chinese: true)
      == "手动读取本地目录")
  #expect(SoftwareManagementPresentation.refresh(.init(mode: "interval"), local: false, chinese: true) == "刷新策略未知")
}

@Test func softwareDatesAcceptBothWireFormatsAndDoNotPresentInvalidTextAsATime() throws {
  let zone = try #require(TimeZone(secondsFromGMT: 0))
  let date = SoftwareManagementPresentation.date("2026-01-01T00:00:00.000Z", chinese: false, timeZone: zone)
  #expect(date == SoftwareManagementPresentation.date("2026-01-01T00:00:00Z", chinese: false, timeZone: zone))
  #expect(!date.contains("T00:00:00") && date.contains("2026"))
  #expect(SoftwareManagementPresentation.date("invalid", chinese: true) == "时间未知")
  #expect(
    date
      != SoftwareManagementPresentation.date(
        "2026-01-01T00:00:00Z", chinese: false, timeZone: try #require(TimeZone(secondsFromGMT: 3600))))
}

private func presentationRun(state: String, items: [String]) throws -> SoftwareInstallationRun {
  try JSONDecoder().decode(
    SoftwareInstallationRun.self,
    from: JSONSerialization.data(withJSONObject: [
      "version": 1, "id": "same-task", "sourceId": "fixture", "planId": "plan", "createdAt": "2026-01-01T00:00:00Z",
      "updatedAt": "2026-01-01T00:00:00Z", "state": state,
      "items": items.enumerated().map { index, state in
        [
          "softwareId": "tool-\(index)", "title": ["en": "Editor \(index)", "zh": "编辑器 \(index)"], "state": state,
          "log": "",
        ] as [String: Any]
      },
    ]))
}

@Test func softwareTaskSummaryCountsProcessedItemsWithoutCallingFailuresSuccessful() throws {
  let run = try presentationRun(
    state: "running", items: ["installed", "failed", "manual", "skipped", "running", "queued"])
  #expect(SoftwareManagementPresentation.processed(run) == 4)
  #expect(SoftwareManagementPresentation.matches(run, filter: "active", query: " 编辑器 ", sourceTitle: "Fixture"))
  #expect(!SoftwareManagementPresentation.matches(run, filter: "completed", query: "", sourceTitle: "Fixture"))
  #expect(!SoftwareManagementPresentation.matches(run, filter: "active", query: "missing", sourceTitle: "Fixture"))
  #expect(SoftwareManagementPresentation.matches(run, filter: "all", query: "Fixture", sourceTitle: "Fixture"))
  let failed = try presentationRun(state: "failed", items: ["installed", "failed"])
  #expect(
    SoftwareManagementPresentation.matches(failed, filter: "attention", query: "same-task", sourceTitle: "Fixture"))
  #expect(!SoftwareManagementPresentation.matches(failed, filter: "completed", query: "", sourceTitle: "Fixture"))
}

@Test func softwareLogSelectionKeepsProviderAndItemIdentitySeparate() {
  let first = SoftwareInstallationLogSelection(runKey: "1:ab", itemID: "c")
  let second = SoftwareInstallationLogSelection(runKey: "1:a", itemID: "bc")
  #expect(first.id != second.id)
}
