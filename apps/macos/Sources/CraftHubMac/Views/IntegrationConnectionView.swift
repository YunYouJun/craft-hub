import CraftHubMacCore
import SwiftUI

struct IntegrationConnectionView: View {
  let model: IntegrationConnectionModel
  let projects: [PaletteProject]
  private var text: L10n { .text }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Text(text.copy("管理连接", "Manage Connection")).font(.title2)
        Spacer()
        if model.loading || model.busy { ProgressView().controlSize(.small) }
      }
      Text(model.title).font(.headline)
      Text(model.project.map { id in projects.first { $0.id == id }?.name ?? id } ?? text.copy("全局", "Global"))
        .foregroundStyle(.secondary)
      if let error = model.error { NativeErrorView(message: error) }
      if let notice = model.notice { Text(notice).foregroundStyle(.secondary) }
      if model.uncertain {
        Button(text.copy("已在服务提供方核对结果，结束本次操作", "I Checked the Provider; Close This Operation")) {
          model.acknowledgeUncertain()
        }.disabled(model.busy)
      }
      if let pending = model.review {
        Text(pending.title).font(.headline)
        if let description = pending.description { Text(description) }
        ScrollView {
          VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(pending.fields.enumerated()), id: \.offset) { _, field in
              LabeledContent(field.label, value: field.value).textSelection(.enabled)
            }
          }
        }.frame(maxHeight: 250)
        Text(
          text.copy(
            "确认将这些信息交给所选插件管理连接。账号授权将在服务提供方的页面完成。",
            "Confirm sending these values to the selected plugin to manage this connection. Account authorization completes on the provider's page."
          )
        )
        .foregroundStyle(.secondary)
        HStack {
          Spacer()
          Button(text.copy("取消", "Cancel")) { model.cancelReview() }.keyboardShortcut(.cancelAction)
          Button(pending.submitLabel) { Task { await model.confirm(pending) } }.keyboardShortcut(.defaultAction)
        }
      } else {
        ScrollView {
          VStack(alignment: .leading, spacing: 14) {
            if let status = model.snapshot {
              Label(
                status.connected ? text.copy("已连接", "Connected") : text.copy("未连接", "Disconnected"),
                systemImage: status.connected ? "checkmark.circle" : "link")
              if let account = status.accountLabel { Text(account).textSelection(.enabled) }
              if let message = status.message { Text(model.text(message)).foregroundStyle(.secondary) }
              if let writes = status.capabilities?.create {
                Text(
                  writes ? text.copy("允许新增内容", "Creation Allowed") : text.copy("尚未授权新增内容", "Creation Not Authorized"))
              }
              if model.stale {
                Text(text.copy("显示上次连接状态，请重新读取后再操作。", "Showing previous status. Reload before making changes."))
              }
              ForEach(Array((status.links ?? []).enumerated()), id: \.offset) { _, link in
                if let url = DesktopBridge.externalURL(link.url) { Link(model.text(link.title), destination: url) }
              }
              ForEach(status.forms ?? []) { form in
                DisclosureGroup(model.text(form.title)) {
                  VStack(alignment: .leading, spacing: 10) {
                    if let description = form.description { Text(model.text(description)).foregroundStyle(.secondary) }
                    ForEach(form.fields) { field in
                      VStack(alignment: .leading, spacing: 4) {
                        Text(model.text(field.label) + (field.required == true ? " *" : ""))
                        if field.type == "password" {
                          SecureField(model.text(field.placeholder ?? ""), text: binding(form, field))
                            .textFieldStyle(.roundedBorder).accessibilityLabel(model.text(field.label))
                        } else if field.type == "text" {
                          TextField(model.text(field.placeholder ?? ""), text: binding(form, field))
                            .textFieldStyle(.roundedBorder).accessibilityLabel(model.text(field.label))
                        }
                      }
                    }
                    Button(model.text(form.submitLabel) + "…") { model.prepare(form) }.disabled(!model.canSubmit(form))
                  }.padding(.top, 8).disabled(model.busy)
                }
              }
            }
            if let authorization = model.authorization {
              Divider()
              if let code = authorization.code {
                Text(text.copy("在授权页面输入登录码", "Enter This Code on the Authorization Page"))
                Text(code).font(.title.monospaced()).textSelection(.enabled)
              }
              Link(text.copy("继续授权", "Continue Authorization"), destination: authorization.url)
              Text(text.copy("等待截止：", "Waiting until: ") + authorization.deadline.formatted()).font(.caption)
              Button(model.watching ? text.copy("停止自动检查", "Stop Automatic Checks") : text.copy("继续检查", "Resume Checks"))
              {
                if model.watching {
                  model.stopWatching(userInitiated: true)
                } else {
                  model.startWatching(userInitiated: true)
                }
              }
            }
          }.frame(maxWidth: .infinity, alignment: .leading)
        }.frame(maxHeight: 470)
        HStack {
          Button(text.copy("重新读取", "Reload")) { Task { await model.load() } }.disabled(model.loading || model.busy)
          Spacer()
          Button(text.copy("关闭", "Close")) { model.close() }.disabled(model.pending).keyboardShortcut(.cancelAction)
        }
      }
    }.padding(24).frame(width: 560).interactiveDismissDisabled(model.pending)
  }
  private func binding(
    _ form: IntegrationPresentation.Connection.Form, _ field: IntegrationPresentation.Connection.Form.Field
  ) -> Binding<String> {
    Binding(get: { model.value(form, field) }, set: { model.edit(form, field, $0) })
  }
}
