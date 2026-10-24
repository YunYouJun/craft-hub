import CraftHubMacCore
import SwiftUI

struct NativeCloudSettings: View {
  @Bindable var model: NativeCloudModel
  @State private var confirmDisconnect = false
  private var text: L10n { .text }
  var body: some View {
    Section(text.copy("个人云", "Personal Cloud")) {
      LabeledContent(text.copy("连接状态", "Connection"), value: stateTitle)
      if let device = model.snapshot?.status.deviceId {
        LabeledContent(text.copy("设备", "Device"), value: device).textSelection(.enabled)
      }
      if let sync = model.snapshot?.status.lastSyncAt { Text(sync).font(.caption).foregroundStyle(.secondary) }
      if let message = model.snapshot?.status.diagnostic { Text(message).foregroundStyle(.secondary) }
      if let error = model.error { NativeErrorView(message: error) }
      if model.snapshot?.status.state == "disabled" {
        Text(text.copy("此候选版尚未配置个人云服务地址。", "Personal-cloud service addresses are not configured for this candidate."))
          .font(.caption).foregroundStyle(.secondary)
      } else {
        Text(
          text.copy(
            "设备身份保存在 macOS 钥匙串中。远程命令须在此 Mac 上逐次确认。",
            "Device identity is stored in macOS Keychain. Every remote command requires review on this Mac.")
        )
        .font(.caption).foregroundStyle(.secondary)
        HStack {
          if model.operating { ProgressView().controlSize(.small) }
          if model.snapshot?.status.state == "connected" {
            Button(text.copy("立即同步", "Sync Now")) { Task { await model.perform("synchronize") } }
          } else {
            Button(text.copy("连接个人云…", "Connect Personal Cloud…")) { Task { await model.perform("connect") } }
          }
          if ["connected", "connecting", "error"].contains(model.snapshot?.status.state ?? "") {
            Button(text.copy("断开连接…", "Disconnect…")) { confirmDisconnect = true }
          }
          Button(text.copy("重新检查", "Check Again")) { Task { await model.checkAgain() } }
        }.disabled(!model.available || model.operating || model.snapshot == nil)
      }
      if !model.approvals.isEmpty {
        Button(text.copy("审阅远程请求（\(model.approvals.count)）", "Review Remote Requests (\(model.approvals.count))")) {
          model.reviewPresented = true
        }
      }
    }
    .confirmationDialog(
      text.copy("断开个人云？", "Disconnect Personal Cloud?"), isPresented: $confirmDisconnect, titleVisibility: .visible
    ) {
      Button(text.copy("断开连接", "Disconnect"), role: .destructive) { Task { await model.perform("disconnect") } }
    } message: {
      Text(
        text.copy(
          "停止同步和待批准请求，撤销设备并清除本机云身份。已开始的本地命令仍在运行记录中管理。",
          "Stop synchronization and pending approvals, revoke this device and clear its local cloud identity. Manage already-started commands in run history."
        ))
    }
    .sheet(isPresented: $model.reviewPresented) { NativeCloudReviewView(model: model) }
  }
  private var stateTitle: String {
    switch model.snapshot?.status.state {
    case "disabled": text.copy("未配置", "Not Configured")
    case "disconnected": text.copy("未连接", "Disconnected")
    case "connecting": text.copy("等待浏览器授权", "Waiting for Browser Authorization")
    case "connected": text.copy("已连接", "Connected")
    case "error": text.copy("需要处理", "Needs Attention")
    default: text.copy("正在读取", "Loading")
    }
  }
}

struct NativeCloudReviewView: View {
  @Bindable var model: NativeCloudModel
  private var text: L10n { .text }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(text.copy("个人云远程请求", "Personal Cloud Remote Request")).font(.title2.bold())
      if let item = model.approvals.first {
        Text(item.capabilityName).font(.headline)
        LabeledContent(text.copy("项目", "Project"), value: item.projectName)
        Text(item.review.projectPath).font(.caption.monospaced()).textSelection(.enabled)
        ScrollView {
          VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(item.review.invocation.steps.enumerated()), id: \.offset) { index, invocation in
              GroupBox(invocation.label ?? text.copy("步骤 \(index + 1)", "Step \(index + 1)")) {
                VStack(alignment: .leading, spacing: 5) {
                  LabeledContent(text.copy("程序", "Executable"), value: invocation.command)
                  LabeledContent(text.copy("工作目录", "Working Directory"), value: invocation.cwd)
                  ForEach(Array(invocation.args.enumerated()), id: \.offset) { index, argument in
                    LabeledContent("argv[\(index)]", value: String(reflecting: argument))
                  }
                  if !invocation.requiredEnv.isEmpty {
                    Text(
                      text.copy("所需环境变量：", "Required environment: ") + invocation.requiredEnv.joined(separator: ", "))
                  }
                }.font(.caption.monospaced()).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
              }
            }
            if let script = item.review.script {
              GroupBox(text.copy("项目脚本", "Project Script")) {
                Text(script).font(.caption.monospaced()).textSelection(.enabled)
              }
            }
          }
        }
        if let error = model.error { NativeErrorView(message: error) }
        TimelineView(.periodic(from: .now, by: 1)) { context in
          HStack {
            Button(text.copy("拒绝", "Reject"), role: .cancel) {
              Task { await model.perform("approve", values: ["id": item.id], accepted: false) }
            }.keyboardShortcut(.cancelAction)
            Spacer()
            if let date = item.expiresAt { Text(date, style: .timer).font(.caption).monospacedDigit() }
            Button(text.copy("批准运行", "Approve Run")) {
              Task { await model.perform("approve", values: ["id": item.id], accepted: true) }
            }.disabled((item.expiresAt ?? .distantPast) <= context.date)
          }.disabled(model.operating)
        }
      } else {
        Text(text.copy("请求已结束、过期或状态不可用。", "The request ended, expired or its state is unavailable."))
        if let error = model.error { NativeErrorView(message: error) }
        Button(text.copy("关闭", "Close")) { model.reviewPresented = false }.keyboardShortcut(.cancelAction)
      }
    }.padding(24).frame(width: 680, height: 560).interactiveDismissDisabled(model.operating)
  }
}
