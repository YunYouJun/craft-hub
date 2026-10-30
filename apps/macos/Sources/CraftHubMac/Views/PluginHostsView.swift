import AppKit
import CraftHubMacCore
import SwiftUI
import UniformTypeIdentifiers

struct PluginHostsView: View {
  @Bindable var model: HostExtensionsModel
  let restart: () async -> Void
  @State private var removal: NativeHostExtensions.External?
  @State private var restarting = false
  private var text: L10n { .text }

  var body: some View {
    List {
      Section {
        Text(
          text.copy(
            "宿主组件提供本机能力，启停和移除在运行时重启后生效。",
            "Host components provide local capabilities. Changes take effect after restarting the runtime."))
        Button(text.copy("添加外部扩展…", "Add External Extension…"), systemImage: "plus", action: chooseManifest)
          .disabled(model.busy || restarting)
        if let error = model.error { NativeErrorView(message: error) }
        if model.snapshot?.restartRequired == true {
          HStack {
            Label(text.copy("需要重启运行时", "Runtime Restart Required"), systemImage: "arrow.clockwise")
            Spacer()
            Button(text.copy("重启运行时", "Restart Runtime")) {
              restarting = true
              Task {
                await restart()
                restarting = false
              }
            }.disabled(model.busy || restarting)
          }
        }
      }
      if let hosts = model.snapshot {
        Section(text.copy("随应用提供", "Bundled with the App")) {
          ForEach(hosts.bundledExtensions ?? []) { host in
            HStack {
              VStack(alignment: .leading, spacing: 4) {
                Text(host.name).font(.headline)
                Text(host.version).font(.caption).foregroundStyle(.secondary)
              }
              Spacer()
              if host.optional == true {
                Toggle(
                  text.copy("启用", "Enabled"),
                  isOn: Binding(
                    get: { host.enabled == true },
                    set: { _ in
                      Task { await model.setBundled(host) }
                    })
                ).toggleStyle(.switch).fixedSize().disabled(model.busy || model.loading || restarting)
                  .accessibilityLabel(text.copy("启用宿主组件：", "Enable host component: ") + host.name)
              } else {
                Text(text.copy("必需组件", "Required")).foregroundStyle(.secondary)
              }
            }
          }
        }
        Section(text.copy("外部扩展", "External Extensions")) {
          if hosts.extensions.isEmpty {
            Text(
              text.copy(
                "尚未添加外部扩展。选择本地 distribution.json，审阅代码位置后确认信任。",
                "No external extensions. Choose a local distribution.json and review its code locations before trusting it."
              )
            )
            .foregroundStyle(.secondary)
          }
          ForEach(hosts.extensions) { host in
            VStack(alignment: .leading, spacing: 8) {
              HStack {
                Text(host.name).font(.headline)
                Spacer()
                Toggle(
                  text.copy("启用", "Enabled"),
                  isOn: Binding(
                    get: { host.enabled },
                    set: { _ in
                      Task { await model.setExternal(host) }
                    })
                ).toggleStyle(.switch).fixedSize()
                  .accessibilityLabel(text.copy("启用外部扩展：", "Enable external extension: ") + host.name)
                Button(text.copy("移除…", "Remove…"), role: .destructive) { removal = host }
                  .accessibilityLabel(text.copy("移除扩展登记：", "Remove extension registration: ") + host.name)
              }.disabled(model.busy || model.loading || restarting)
              Text(host.manifestPath).font(.caption.monospaced()).textSelection(.enabled)
              DisclosureGroup(text.copy("已信任的模块位置", "Trusted Module Locations")) {
                ForEach(host.modules, id: \.self) { Text($0).font(.caption.monospaced()).textSelection(.enabled) }
              }
            }.padding(.vertical, 6)
          }
        }
        if !hosts.diagnostics.isEmpty {
          Section(text.copy("加载诊断", "Load Diagnostics")) {
            ForEach(hosts.diagnostics.indices, id: \.self) { index in
              Text(hosts.diagnostics[index].message).textSelection(.enabled)
            }
          }
        }
      }
    }.listStyle(.inset)
      .nativePageListContent()
      .task { await model.load() }
      .onDisappear { model.cancelReview() }
      .sheet(isPresented: Binding(get: { model.review != nil }, set: { if !$0 { model.cancelReview() } })) {
        HostExtensionReviewView(model: model)
      }
      .confirmationDialog(
        text.copy("移除扩展登记？", "Remove Extension Registration?"),
        isPresented: Binding(get: { removal != nil }, set: { if !$0 { removal = nil } }), titleVisibility: .visible
      ) {
        if let host = removal {
          Button(text.copy("移除", "Remove"), role: .destructive) {
            Task { await model.remove(host) }
            removal = nil
          }
        }
      } message: {
        Text(
          (removal?.name ?? "") + "\n"
            + text.copy(
              "保留源文件与用户数据。已加载的代码在运行时重启前仍然生效。",
              "Source files and user data are retained. Loaded code stays active until the runtime restarts."))
      }
  }

  private func chooseManifest() {
    let panel = NSOpenPanel()
    panel.canChooseFiles = true
    panel.canChooseDirectories = false
    panel.allowsMultipleSelection = false
    panel.allowedContentTypes = [.json]
    panel.message = text.copy(
      "选择扩展的 distribution.json，下一步审阅模块位置。", "Choose the extension's distribution.json to review its module locations.")
    panel.begin { response in
      guard response == .OK, let path = panel.url?.path else { return }
      Task { await model.preview(path) }
    }
  }
}

private struct HostExtensionReviewView: View {
  @Bindable var model: HostExtensionsModel
  private var text: L10n { .text }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(text.copy("信任外部宿主扩展", "Trust External Host Extension")).font(.title2.bold())
      Text(
        text.copy(
          "扩展可在本机运行代码并访问当前用户的数据。确认后会记住下列模块位置，在每次启动时加载这些位置的代码，包括后续本地修改。仅添加你信任的扩展。",
          "Extensions run local code and can access your user data. Trust remembers these module locations and loads their code on every startup, including later local changes. Only add extensions you trust."
        ))
      if let review = model.review {
        ScrollView {
          VStack(alignment: .leading, spacing: 14) {
            registration(review.extension, title: text.copy("将要添加", "To Be Registered"))
            if let previous = review.previous {
              registration(previous, title: text.copy("替换已有登记", "Replaces Existing Registration"))
            }
          }.frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
        }
        if let error = model.reviewError { NativeErrorView(message: error) }
        if model.reviewConsumed {
          Text(
            text.copy(
              "本次审阅已使用。请重新读取并核对后再确认。", "This review was used. Read and review the declaration again before confirming.")
          )
          .foregroundStyle(.secondary)
        }
        HStack {
          Button(text.copy("取消", "Cancel")) { model.cancelReview() }.keyboardShortcut(.cancelAction)
          Spacer()
          if model.busy { ProgressView().controlSize(.small) }
          if model.reviewConsumed {
            Button(text.copy("重新读取", "Read Again")) {
              Task { await model.preview(review.extension.manifestPath, keepingReview: true) }
            }
          }
          Button(text.copy("信任并添加", "Trust and Add")) { Task { await model.confirm() } }
            .disabled(!model.canConfirm)
        }.disabled(model.busy)
      }
    }.padding(24).frame(width: 640, height: 560).interactiveDismissDisabled(model.busy)
  }
  private func registration(_ item: NativeHostExtensions.External, title: String) -> some View {
    GroupBox(title) {
      VStack(alignment: .leading, spacing: 6) {
        Text(item.name).font(.headline)
        Text(item.id).font(.caption.monospaced())
        Text(item.manifestPath).font(.caption.monospaced()).foregroundStyle(.secondary)
        ForEach(item.modules, id: \.self) { Text($0).font(.callout.monospaced()) }
      }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
    }
  }
}
