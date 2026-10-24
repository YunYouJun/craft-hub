import CraftHubMacCore
import SwiftUI

struct EnvironmentSourcesView: View {
  @Bindable var model: EnvironmentSourcesModel
  private var text: L10n { L10n.text }
  var body: some View {
    List {
      Section {
        Text(
          text.copy(
            "连接配置仓库，已有 Git 登录会自动尝试。连接准备配置来源，完成后继续审阅并应用配置。",
            "Connect a configuration repository using existing Git sign-in when available. Connecting prepares the source; review and apply configuration afterward."
          )
        )
        .foregroundStyle(.secondary)
        HStack {
          Button(text.copy("重新检查连接", "Recheck Connections")) { Task { await model.load() } }.disabled(
            model.busy || model.loading)
          if model.busy || model.loading { ProgressView().controlSize(.small) }
        }
        if let error = model.error { NativeErrorView(message: error) }
      }
      if let snapshot = model.snapshot {
        if snapshot.providers.isEmpty {
          Text(text.copy("当前运行时没有可连接配置源的提供方。", "No source connection provider is available in this runtime."))
            .foregroundStyle(.secondary)
        } else {
          Section(text.copy("配置仓库", "Configuration Repository")) {
            Picker(text.copy("提供方", "Provider"), selection: $model.provider) {
              ForEach(snapshot.providers) { Text($0.name).tag($0.id) }
            }.disabled(model.busy)
            Picker(text.copy("来源类型", "Source Type"), selection: $model.kind) {
              ForEach(snapshot.providers.first { $0.id == model.provider }?.kinds ?? [], id: \.self) { kind in
                Text(
                  kind == "private"
                    ? text.copy("私有配置", "Private Configuration") : text.copy("公开配置", "Public Configuration")
                ).tag(kind)
              }
            }.disabled(model.busy || model.active?.active == true)
            TextField(text.copy("HTTPS 仓库地址", "HTTPS Repository URL"), text: $model.repository)
              .textFieldStyle(.roundedBorder).disabled(model.busy || model.active?.active == true)
            Text(text.copy("使用不含用户名、令牌或查询参数的仓库地址。", "Use a repository URL without credentials or query parameters."))
              .font(.caption).foregroundStyle(.secondary)
            Button(text.copy("连接配置源", "Connect Source")) { Task { await model.connect() } }.disabled(!model.canConnect)
          }
          if let job = model.active {
            Section(text.copy("连接状态", "Connection Status")) {
              Text(job.repository).textSelection(.enabled)
              Text(state(job)).fontWeight(.medium)
              if let error = job.error { Text(failure(error)).foregroundStyle(.secondary) }
              if let path = job.localPath { Text(path).font(.caption).textSelection(.enabled) }
              if job.state == "authentication-required" {
                EnvironmentSourceAuthentication(model: model, job: job).id(job.id + job.state)
              }
              if job.active {
                Button(text.copy("取消连接", "Cancel Connection")) { Task { await model.cancel(job) } }
                  .disabled(model.busy || model.uncertain || job.phase == "binding")
                LabeledContent(text.copy("有效期至", "Expires At"), value: job.expiresAt)
              }
            }
          }
        }
      }
    }.listStyle(.inset)
      .task {
        await model.load()
        guard !Task.isCancelled else { return }
        model.startObserving()
      }
      .onDisappear { model.stopObserving() }
      .onChange(of: model.provider) {
        let kinds = model.snapshot?.providers.first { $0.id == model.provider }?.kinds ?? []
        if !kinds.contains(model.kind) { model.kind = kinds.first ?? "public" }
      }
  }
  private func state(_ job: EnvironmentSourcesSnapshot.Connection) -> String {
    switch job.state {
    case "connected": text.copy("配置源已连接，请继续检查与审阅恢复。", "Source connected. Continue to check and review recovery.")
    case "authentication-required": text.copy("需要认证", "Authentication Required")
    case "cancelled": text.copy("连接已取消", "Connection Cancelled")
    case "failed": text.copy("连接未完成", "Connection Failed")
    case "connecting":
      job.phase == "binding"
        ? text.copy("正在保存已验证的配置源…", "Saving the validated source…")
        : job.phase == "validating"
          ? text.copy("正在验证配置内容…", "Validating configuration…")
          : text.copy("正在获取仓库，请完成可能出现的 Git 登录窗口…", "Getting the repository; complete any Git sign-in window…")
    default: text.copy("状态未知，请重新检查", "Unknown; Check Again")
    }
  }
  private func failure(_ value: String) -> String {
    switch value {
    case "authentication-required":
      text.copy(
        "需要登录或凭据无效。请核对仓库地址并认证。",
        "Sign-in is required or credentials were rejected. Check the repository and authenticate.")
    case "invalid-source":
      text.copy(
        "配置源验证失败，请确认仓库包含有效配置。", "Source validation failed. Check that the repository contains valid configuration.")
    case "destination-conflict":
      text.copy("本机存在不同仓库或来源已变化，请核对后重试。", "A different checkout exists or the source changed. Review before retrying.")
    default:
      text.copy("连接未完成，请检查网络、Git 和提供方状态。", "Connection did not complete. Check the network, Git and provider state.")
    }
  }
}

/// Credentials live only for this visible authentication form and are cleared before dispatch and on dismissal.
private struct EnvironmentSourceAuthentication: View {
  let model: EnvironmentSourcesModel
  let job: EnvironmentSourcesSnapshot.Connection
  @State private var username = ""
  @State private var token = ""
  private var text: L10n { L10n.text }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(
        text.copy(
          "凭据只用于此仓库的本次连接，Craft Hub 不保存。",
          "Credentials are used for this repository connection only; Craft Hub does not save them.")
      )
      .foregroundStyle(.secondary)
      Text(job.repository).fontWeight(.medium).textSelection(.enabled)
      TextField(text.copy("Git 用户名", "Git Username"), text: $username)
      SecureField(text.copy("访问令牌", "Access Token"), text: $token)
      Button(text.copy("认证并继续", "Authenticate and Continue")) {
        let user = username
        let secret = token
        username = ""
        token = ""
        Task { await model.authenticate(job, username: user, token: secret) }
      }.disabled(username.isEmpty || token.isEmpty)
    }.disabled(model.busy || model.uncertain)
      .onDisappear {
        username = ""
        token = ""
      }
  }
}
