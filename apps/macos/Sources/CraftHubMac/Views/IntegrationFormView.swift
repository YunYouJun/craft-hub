import CraftHubMacCore
import SwiftUI

struct IntegrationFormView: View {
  let model: IntegrationFormModel
  let projects: [PaletteProject]
  let openWeb: () -> Void
  private var text: L10n { .text }
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Text(model.title.isEmpty ? text.copy("插件表单", "Plugin Form") : model.title).font(.title2)
        Spacer()
        if model.busy { ProgressView().controlSize(.small) }
      }
      Text(model.project.map { id in projects.first { $0.id == id }?.name ?? id } ?? text.copy("全局", "Global"))
        .foregroundStyle(.secondary)
      if let error = model.error { NativeErrorView(message: error) }
      if model.uncertain {
        Button(text.copy("已在来源核对结果，结束本次操作", "I Checked the Source; Close This Operation")) {
          model.acknowledgeUncertain()
        }
      }
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          if let plan = model.plan {
            Text(plan.title).font(.headline)
            if let description = plan.description { Text(description) }
            Text(effect(plan.effect)).foregroundStyle(.secondary)
            if plan.project?.trust == "untrusted" {
              Text(
                text.copy(
                  "项目尚未信任；需要信任的操作仍会被运行时拒绝。",
                  "This project is untrusted. Operations requiring trust will still be rejected.")
              )
              .foregroundStyle(.secondary)
            }
            ForEach(Array(plan.fields.enumerated()), id: \.offset) { _, field in
              VStack(alignment: .leading, spacing: 4) {
                Text(field.label).foregroundStyle(.secondary)
                Text(field.value).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
              }
            }
            Text(text.copy("此审阅有效期为十分钟，只能提交一次。", "This review expires in ten minutes and can be submitted once."))
              .font(.caption).foregroundStyle(.secondary)
          } else if model.receiptNeedsRefresh {
            Label(text.copy("已收到操作结果", "Operation Result Received"), systemImage: "checkmark.circle")
            Text(
              text.copy(
                "来源在提交期间发生变化。请关闭表单并重新读取当前页面。",
                "The source changed during submission. Close this form and reload the current page."))
          } else if let result = model.result {
            Label(text.copy("已收到操作结果", "Operation Result Received"), systemImage: "checkmark.circle")
            ForEach(result.entityPage?.items ?? [], id: \.key) { item in
              VStack(alignment: .leading, spacing: 4) {
                Text(item.title).font(.headline)
                if let description = item.description { Text(description) }
                if let status = item.statusLabel ?? item.status { Text(status).foregroundStyle(.secondary) }
                if let url = DesktopBridge.externalURL(item.url) {
                  Link(text.copy("打开原文", "Open Original"), destination: url)
                }
              }.textSelection(.enabled)
            }
            if let resources = result.resources {
              Text(resources.title).font(.headline)
              if let description = resources.description { Text(description) }
              Text(text.copy("关闭后返回资源页面查看最新内容。", "Close to return to the updated resource page."))
            }
            if let connection = result.connection {
              Text(connection.connected ? text.copy("已连接", "Connected") : text.copy("未连接", "Disconnected"))
              if let message = connection.message { Text(message) }
              if let url = DesktopBridge.externalURL(connection.authorizationUrl) {
                Link(text.copy("继续授权", "Continue Authorization"), destination: url)
              }
              if let device = connection.deviceAuthorization,
                let url = DesktopBridge.externalURL(device.verificationUrl)
              {
                Text(device.userCode).font(.title.monospaced()).textSelection(.enabled)
                Link(text.copy("继续授权", "Continue Authorization"), destination: url)
              }
            }
            if result.kind == "unsupported" {
              Text(text.copy("此结果请在完整工作台查看。", "View this result in the full workbench."))
            }
          } else {
            if let description = model.description { Text(description).foregroundStyle(.secondary) }
            if model.stale { Text(text.copy("请重新读取当前表单。", "Reload the current form.")) }
            ForEach(model.fields) { field in
              VStack(alignment: .leading, spacing: 5) {
                Text(model.text(field.label) + (field.required == true ? " *" : ""))
                if field.type == "checkbox" {
                  Toggle(
                    model.text(field.label),
                    isOn: Binding(
                      get: { model.value(field) == "true" }, set: { model.edit(field, value: $0 ? "true" : "false") }))
                } else if field.type == "select" {
                  Picker(model.text(field.label), selection: binding(field)) {
                    Text(text.copy("请选择", "Choose")).tag("")
                    ForEach(Array((field.options ?? []).enumerated()), id: \.offset) { _, option in
                      Text(model.text(option.label)).tag(option.value)
                    }
                  }.labelsHidden()
                } else if field.type == "textarea" {
                  TextEditor(text: binding(field)).font(.body).frame(minHeight: 120)
                    .accessibilityLabel(model.text(field.label))
                } else {
                  TextField(model.text(field.placeholder ?? ""), text: binding(field))
                    .textFieldStyle(.roundedBorder).accessibilityLabel(model.text(field.label))
                }
                if let suggestions = field.suggestions, !suggestions.isEmpty {
                  Menu(text.copy("附加建议内容", "Append Suggested Text")) {
                    ForEach(Array(suggestions.enumerated()), id: \.offset) { _, suggestion in
                      Button(model.text(suggestion.label)) {
                        model.edit(field, value: model.value(field) + suggestion.value)
                      }
                    }
                  }
                }
              }.disabled(model.busy || model.uncertain)
            }
          }
        }.frame(maxWidth: .infinity, alignment: .leading)
      }.frame(maxHeight: 500)
      HStack {
        Button(text.copy("完整工作台…", "Full Workbench…")) { openWeb() }.disabled(model.pending)
        Spacer()
        if let plan = model.plan {
          Button(text.copy("返回编辑", "Back to Editing")) { model.cancelReview() }.keyboardShortcut(.cancelAction)
          Button(text.copy("确认提交", "Confirm Submission")) { Task { await model.execute(plan) } }.disabled(model.busy)
            .keyboardShortcut(.defaultAction)
        } else {
          Button(text.copy("关闭", "Close")) { model.close() }.disabled(model.pending).keyboardShortcut(.cancelAction)
          if model.result == nil && !model.receiptNeedsRefresh {
            Button(text.copy("重新读取", "Reload")) { Task { await model.reload() } }.disabled(
              model.busy || model.uncertain)
            Button(text.copy("继续…", "Continue…")) { Task { await model.prepare() } }.disabled(!model.canPrepare)
              .keyboardShortcut(.defaultAction)
          }
        }
      }
    }.padding(24).frame(width: 620).interactiveDismissDisabled(model.pending)
  }
  private func binding(_ field: IntegrationFormField) -> Binding<String> {
    Binding(get: { model.value(field) }, set: { model.edit(field, value: $0) })
  }
  private func effect(_ value: String) -> String {
    switch value {
    case "local-write": text.copy("修改本机内容", "Changes Local Data")
    case "remote-write": text.copy("提交到来源服务", "Submits to the Source Service")
    case "local-read": text.copy("读取本机内容", "Reads Local Data")
    default: text.copy("读取来源内容", "Reads Source Data")
    }
  }
}
