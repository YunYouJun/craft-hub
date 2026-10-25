import CraftHubMacCore
import SwiftUI

/// Native environment inspection, portable intent and source connection workflows.
struct EnvironmentView: View {
  @Bindable var machine: MachineModel
  let openWeb: (String) -> Void
  let openSoftware: () -> Void
  let openConfiguration: (String) -> Void
  private var text: L10n { L10n.text }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        VStack(alignment: .leading, spacing: 5) {
          Text(text.copy("开发环境", "Environment")).font(.largeTitle.bold())
          Text(
            text.copy(
              "检查工具、保存环境方案并连接配置来源", "Inspect tools, save environment profiles and connect configuration sources")
          )
          .foregroundStyle(.secondary)
        }
        Spacer()
        Button(text.copy("环境配置", "Configuration")) { machine.environmentTab = "configuration" }
        Button {
          Task { await machine.loadEnvironment(force: true) }
        } label: {
          Label(text.copy("重新检查", "Check Again"), systemImage: "arrow.clockwise")
        }
        .disabled(machine.checkingEnvironment)
      }
      .padding(24)
      Picker(text.copy("环境页面", "Environment Page"), selection: $machine.environmentTab) {
        Text(text.copy("本机工具", "Local Tools")).tag("inspection")
        Text(text.copy("环境方案", "Environment Profile")).tag("profile")
        Text(text.copy("配置源连接", "Source Connections")).tag("sources")
        Text(text.copy("配置审阅", "Configuration")).tag("configuration")
      }.pickerStyle(.segmented).padding(.horizontal, 24).padding(.bottom, 12)
      if machine.environmentTab == "profile" {
        EnvironmentProfileView(
          model: machine.environmentProfile, openSoftware: openSoftware, openConfiguration: openConfiguration)
      } else if machine.environmentTab == "sources" {
        EnvironmentSourcesView(model: machine.environmentSources)
      } else if machine.environmentTab == "configuration" {
        ConfigurationView(model: machine.configuration, openWeb: openWeb)
      } else {
        inspection
      }
    }
    .task { await machine.loadEnvironment() }
  }
  private var inspection: some View {
    VStack(alignment: .leading, spacing: 0) {
      if machine.checkingEnvironment {
        ProgressView().controlSize(.small).padding(.horizontal, 24).padding(.bottom, 12)
      }
      if let error = machine.environmentError { NativeErrorView(message: error).padding(.horizontal, 24) }
      if let snapshot = machine.environment {
        List {
          Section(text.copy("当前运行时", "Active Runtime")) {
            LabeledContent {
              Text(snapshot.runtime.version).foregroundStyle(.secondary)
            } label: {
              HStack(spacing: 8) {
                EnvironmentToolIconView(toolID: "node", size: 20)
                Text("Node")
              }
            }
            LabeledContent(text.copy("可执行文件", "Executable")) {
              Text(snapshot.runtime.executablePath).textSelection(.enabled).foregroundStyle(.secondary)
            }
            LabeledContent(
              text.copy("系统", "System"),
              value: "\(snapshot.host.platform) · \(snapshot.host.arch) · \(snapshot.host.osRelease)")
          }
          Section(text.copy("开发工具", "Developer Tools")) {
            ForEach(snapshot.tools) { tool in
              HStack(alignment: .top, spacing: 12) {
                EnvironmentToolIconView(toolID: tool.id)
                  .padding(.top, 2)
                VStack(alignment: .leading, spacing: 4) {
                  Text(tool.name).fontWeight(.medium)
                  if let path = tool.executablePath {
                    Text(path).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                  }
                  if let message = tool.message { Text(message).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                  HStack(spacing: 5) {
                    Image(systemName: tool.status == "available" ? "checkmark.circle.fill" : "exclamationmark.circle")
                      .foregroundStyle(tool.status == "available" ? Color.green : Color.secondary)
                      .accessibilityHidden(true)
                    Text(text.toolStatus(tool.status))
                  }
                  if let version = tool.version { Text(version).font(.caption).foregroundStyle(.secondary) }
                }
              }
              .padding(.vertical, 6)
            }
          }
          Section(text.copy("检查范围", "Search Locations")) {
            Text(
              text.copy(
                "未检测到表示本次搜索没有找到，不代表工具未安装。",
                "Not detected means the bounded search found no tool; it may be installed elsewhere.")
            )
            .font(.callout).foregroundStyle(.secondary)
            DisclosureGroup(text.copy("搜索路径", "Search Paths")) {
              ForEach(snapshot.searchDirectories, id: \.self) { Text($0).font(.caption).textSelection(.enabled) }
            }
            LabeledContent(text.copy("检查时间", "Checked At"), value: snapshot.checkedAt)
          }
        }
        .listStyle(.inset)
      } else if !machine.checkingEnvironment && machine.environmentError == nil {
        ContentUnavailableView(text.copy("尚未检查环境", "Environment Not Checked"), systemImage: "terminal")
      }
      Spacer(minLength: 0)
    }
  }
}

struct NativeErrorView: View {
  let message: String
  var body: some View {
    Label(message, systemImage: "exclamationmark.triangle")
      .foregroundStyle(.secondary).textSelection(.enabled)
      .padding(12).frame(maxWidth: .infinity, alignment: .leading)
      .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
      .accessibilityLabel(L10n.text.copy("请求失败：", "Request failed: ") + message)
  }
}
