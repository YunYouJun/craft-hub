import AppKit
import CraftHubMacCore
import SwiftUI

struct SoftwareSourceCard: View {
  let source: SoftwareRepositorySource
  let localAvailable: Bool
  let busy: Bool
  let edit: () -> Void
  let reload: () -> Void
  let configure: () -> Void
  let remove: () -> Void
  @State private var expanded = false
  private var text: L10n { .text }
  private var local: Bool { source.mode == "local" }
  private var location: String { source.repository ?? source.localPath ?? source.catalogPath }
  private var schedule: String {
    SoftwareManagementPresentation.refresh(source.refreshPolicy, local: local, chinese: text.chinese)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 12) {
        Image(systemName: local ? "folder" : "shippingbox")
          .font(.title3).foregroundStyle(Color.accentColor).frame(width: 38, height: 38)
          .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 9)).accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 4) {
          HStack(spacing: 8) {
            Text(source.title).font(.system(size: 14, weight: .semibold)).lineLimit(1).help(source.title)
            Text(local ? text.copy("本地目录", "Local") : text.copy("线上仓库", "Online"))
              .font(.caption).foregroundStyle(.secondary)
          }
          Text(location).font(.callout).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle).help(location)
        }.frame(maxWidth: .infinity, alignment: .leading)
        SoftwareStatusBadge(
          title: source.error == nil ? text.copy("缓存可用", "Cached") : text.copy("刷新失败", "Refresh Failed"),
          symbol: source.error == nil ? "checkmark.circle" : "exclamationmark.triangle",
          color: source.error == nil ? .green : .orange)
        Button(action: reload) { Label(text.copy("刷新目录", "Refresh Catalog"), systemImage: "arrow.clockwise") }
          .disabled(busy || (local && !localAvailable)).accessibilityLabel(
            text.copy("刷新目录：", "Refresh Catalog: ") + source.title)
        menu
      }.controlSize(.small)
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 16) {
          metadata
          refreshControl
        }
        VStack(alignment: .leading, spacing: 8) {
          metadata
          refreshControl
        }
      }
      if source.error != nil {
        Label(
          text.copy(
            "上次刷新失败，已保留有效缓存。可在来源详情核对配置。",
            "The last refresh failed; the valid cache is retained. Review the source details to check its configuration."
          ),
          systemImage: "exclamationmark.triangle"
        ).font(.caption).foregroundStyle(.secondary)
      }
      DisclosureGroup(isExpanded: $expanded) {
        VStack(alignment: .leading, spacing: 8) {
          Divider().padding(.vertical, 4)
          if source.error != nil {
            NativeErrorView(
              message: text.copy(
                "暂时无法读取该来源，请检查仓库地址、分支或网络连接后重试。",
                "This source could not be read. Check its repository URL, branch or network connection, then retry."))
          }
          if let repository = source.repository { detail(text.copy("仓库", "Repository"), value: repository) }
          if let path = source.localPath { detail(text.copy("本地路径", "Local Path"), value: path) }
          detail(text.copy("分支", "Branch"), value: source.branch)
          detail(text.copy("目录文件", "Catalog File"), value: source.catalogPath)
          if let commit = source.cache.commit { detail(text.copy("提交", "Commit"), value: commit) }
          detail(
            text.copy("缓存保存", "Cache Saved"),
            value: SoftwareManagementPresentation.date(source.cache.savedAt, chinese: text.chinese))
        }.padding(.top, 4)
      } label: {
        HStack(spacing: 8) {
          Text(text.copy("来源详情", "Source Details"))
          if let commit = source.cache.commit {
            Text(String(commit.prefix(7))).font(.caption.monospaced()).foregroundStyle(.tertiary)
          }
        }.font(.caption).foregroundStyle(.secondary)
      }
    }.softwareManagementCard().accessibilityElement(children: .contain)
  }
  private var metadata: some View {
    HStack(spacing: 16) {
      Label(
        text.copy("\(source.cache.itemCount) 款软件", "\(source.cache.itemCount) apps"), systemImage: "square.grid.2x2")
      Label(source.branch, systemImage: "arrow.triangle.branch").lineLimit(1).help(source.branch)
      Label(
        text.copy("检查于 ", "Checked ") + SoftwareManagementPresentation.date(source.checkedAt, chinese: text.chinese),
        systemImage: "clock"
      )
      .help(source.checkedAt)
    }.font(.caption).foregroundStyle(.secondary)
  }
  @ViewBuilder private var refreshControl: some View {
    if local {
      Label(schedule, systemImage: "arrow.clockwise").font(.caption).foregroundStyle(.secondary)
    } else {
      Button(action: configure) { Label(schedule, systemImage: "arrow.triangle.2.circlepath") }
        .buttonStyle(.link).font(.caption).disabled(busy || !localAvailable)
        .accessibilityLabel(text.copy("自动刷新：", "Automatic Refresh: ") + source.title + " · " + schedule)
        .help(text.copy("修改自动刷新策略，仅在应用运行时执行", "Change the refresh schedule; runs while the app is open"))
    }
  }
  private var menu: some View {
    Menu {
      Button(text.copy("编辑来源…", "Edit Source…"), action: edit).disabled(busy)
      Button(text.copy("自动刷新…", "Automatic Refresh…"), action: configure).disabled(busy || local || !localAvailable)
      if let url = DesktopBridge.externalURL(source.repository) {
        Button(text.copy("打开仓库", "Open Repository")) { NSWorkspace.shared.open(url) }
      }
      Divider()
      Button(text.copy("移除来源…", "Remove Source…"), role: .destructive, action: remove).disabled(busy)
    } label: {
      Image(systemName: "ellipsis").frame(width: 22, height: 24)
    }
    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
    .accessibilityLabel(text.copy("来源操作：", "Source Actions: ") + source.title)
  }
  private func detail(_ title: String, value: String) -> some View {
    HStack(alignment: .top, spacing: 12) {
      Text(title).foregroundStyle(.secondary).frame(width: 90, alignment: .leading)
      Text(value).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
    }.font(.caption)
  }
}
