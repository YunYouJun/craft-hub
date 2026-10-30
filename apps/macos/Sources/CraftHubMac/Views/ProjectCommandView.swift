import AppKit
import CraftHubMacCore
import SwiftUI

/// Native review and terminal presentation; all resolution, trust and execution remain runtime operations.
struct ProjectCommandView: View {
  @Bindable var model: ProjectCommandModel
  var externalTerminal: ProjectTerminalModel?
  let back: () -> Void
  let openWeb: () -> Void
  @State private var stopReview = false
  private var text: L10n { .text }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 10) {
        HStack {
          Button(action: back) { Label(text.copy("项目能力", "Project Capabilities"), systemImage: "chevron.left") }
            .disabled(!model.canChangeContext)
          Spacer()
          Button(text.copy("完整项目…", "Full Project…"), action: openWeb).disabled(!model.canChangeContext)
          Button(text.reload) { Task { await model.load(force: true) } }.disabled(
            model.loading || !model.canChangeContext)
        }
        if let externalTerminal {
          ProjectTerminalControl(model: externalTerminal, projectID: model.projectID, capabilityID: model.capabilityID)
        }
      }.padding(.horizontal, NativePageLayout.horizontalInset).padding(.vertical)
      if let error = model.error {
        NativeErrorView(message: error).padding(.horizontal, NativePageLayout.horizontalInset)
      }
      if model.uncertain {
        VStack(alignment: .leading, spacing: 8) {
          Text(
            text.copy(
              "操作结果尚未确认。请检查运行记录，确认状态后再继续。",
              "The operation outcome is uncertain. Check the run history before continuing."))
          HStack {
            Button(text.copy("重新读取运行记录", "Reload Run History")) { Task { await model.refreshRuns() } }
            Button(text.copy("我已核对运行状态", "I Have Checked the Run Status")) { model.acknowledgeUncertain() }
          }
        }.padding(.horizontal, NativePageLayout.horizontalInset).padding(.vertical).background(.orange.opacity(0.1))
      }
      if model.loading && model.command == nil {
        ProgressView(text.copy("正在读取命令", "Reading Command")).frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if let command = model.command {
        VSplitView {
          ScrollView {
            VStack(alignment: .leading, spacing: 16) {
              header(command).nativePageContent(.form)
              VStack(alignment: .leading, spacing: 16) {
                if model.releaseFallback {
                  Text(text.copy("此命令包含发布操作，请在完整项目中审阅发布计划。", "Review this command's release plan in the full project."))
                  Button(text.copy("审阅发布计划…", "Review Release Plan…"), action: openWeb)
                } else {
                  inputs
                  if model.previewing { ProgressView(text.copy("正在解析参数", "Resolving Inputs")).controlSize(.small) }
                  if let error = model.previewError { NativeErrorView(message: error) }
                  if let invocation = model.invocation { invocationView(invocation) }
                  HStack {
                    Button(text.copy("审阅并运行…", "Review and Run…")) { Task { await model.prepareReview() } }
                      .buttonStyle(.borderedProminent).disabled(!model.canPrepare)
                      .accessibilityIdentifier("command.prepare")
                    if model.loading || (model.busy && model.run?.isRunning != true) {
                      ProgressView().controlSize(.small)
                    }
                    if model.stale {
                      Text(text.copy("命令信息已过期，请重新读取。", "Command information is stale. Reload before reviewing."))
                        .font(.caption).foregroundStyle(.secondary)
                    }
                  }
                }
                history
              }.nativePageContent(.form)
            }.padding(.vertical, 20)
          }.frame(minHeight: 200)
          if let run = model.run {
            terminal(run).frame(minHeight: 210, idealHeight: 300)
          }
        }
      } else {
        ContentUnavailableView {
          Label(text.copy("命令暂不可用", "Command Unavailable"), systemImage: "terminal")
        } actions: {
          Button(text.copy("打开完整项目…", "Open Full Project…"), action: openWeb)
        }.nativePageContent(.emptyState)
      }
    }
    .task(id: "\(model.projectID ?? "")/\(model.capabilityID ?? "")") { await model.load() }
    .sheet(isPresented: Binding(get: { model.review != nil }, set: { if !$0 { model.cancelReview() } })) {
      if let review = model.review { reviewSheet(review) }
    }
    .confirmationDialog(text.copy("停止此命令？", "Stop This Command?"), isPresented: $stopReview) {
      Button(text.copy("停止命令", "Stop Command"), role: .destructive) { Task { await model.cancelRun() } }
      Button(text.copy("取消", "Cancel"), role: .cancel) {}
    } message: {
      Text(
        text.copy(
          "运行时将停止当前任务，已经产生的文件和外部操作不会撤销。",
          "The runtime will stop this task. Existing file changes and external effects remain."))
    }
  }

  private func header(_ command: ProjectCommand) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(command.name).font(.title2)
      if let description = command.description { Text(description).textSelection(.enabled) }
      if let project = model.details?.project {
        Text("\(project.name) · \(project.path)").font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
      }
      Text(command.source).font(.caption).foregroundStyle(.secondary)
      if let script = command.script {
        GroupBox(text.copy("脚本定义", "Script Definition")) {
          Text(script).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
      if command.availability?.available == false {
        NativeErrorView(
          message: command.availability?.diagnostic ?? text.copy("当前命令不可用。", "This command is unavailable."))
      }
    }
  }

  private var inputs: some View {
    VStack(alignment: .leading, spacing: 12) {
      ForEach(model.visibleInputs, id: \.id) { input in
        VStack(alignment: .leading, spacing: 4) {
          let label = (input.label ?? input.id) + (input.isRequired(model.inputValues) ? " *" : "")
          if input.type == "boolean" {
            Toggle(
              label,
              isOn: Binding(
                get: { model.inputValues[input.id] == "true" },
                set: { model.editInput(input.id, value: $0 ? "true" : "false") })
            )
            .accessibilityIdentifier("command.input.\(input.id)")
          } else if input.type == "select" {
            Picker(label, selection: value(input.id)) {
              Text(text.copy("请选择", "Choose")).tag("")
              ForEach(input.options ?? [], id: \.value) { option in Text(option.label ?? option.value).tag(option.value)
              }
            }.accessibilityIdentifier("command.input.\(input.id)")
          } else if input.privateValue == true {
            SecureField(label, text: value(input.id)).textFieldStyle(.roundedBorder)
              .accessibilityIdentifier("command.input.\(input.id)")
          } else {
            TextField(label, text: value(input.id)).textFieldStyle(.roundedBorder)
              .accessibilityIdentifier("command.input.\(input.id)")
          }
          if let description = input.description { Text(description).font(.caption).foregroundStyle(.secondary) }
        }
      }
    }.disabled(!model.canChangeContext || model.busy)
  }

  private func value(_ id: String) -> Binding<String> {
    Binding(get: { model.inputValues[id] ?? "" }, set: { model.editInput(id, value: $0) })
  }

  private func invocationView(_ invocation: ProjectCommandInvocation) -> some View {
    GroupBox(text.copy("执行内容", "Invocation")) {
      VStack(alignment: .leading, spacing: 8) {
        LabeledContent(text.copy("程序", "Program"), value: invocation.command)
        LabeledContent(text.copy("工作目录", "Working Directory"), value: invocation.cwd)
        if !invocation.args.isEmpty {
          Text(text.copy("参数（每行一项）", "Arguments (One per Line)")).font(.caption).foregroundStyle(.secondary)
          Text(invocation.args.enumerated().map { "\($0.offset + 1). \($0.element)" }.joined(separator: "\n"))
            .font(.system(.callout, design: .monospaced))
        }
        LabeledContent(
          text.copy("所需环境变量", "Required Environment"), value: invocation.requiredEnv.joined(separator: ", "))
        if let prerequisites = invocation.prerequisites, !prerequisites.isEmpty {
          Text(text.copy("先执行", "Prerequisites")).font(.headline)
          ForEach(Array(prerequisites.enumerated()), id: \.offset) { _, step in
            VStack(alignment: .leading, spacing: 3) {
              if let label = step.label { Text(label).fontWeight(.medium) }
              Text(([step.command] + step.args).joined(separator: "\n"))
                .font(.system(.callout, design: .monospaced))
              Text(step.cwd).font(.caption).foregroundStyle(.secondary)
              if !step.requiredEnv.isEmpty {
                Text(text.copy("所需环境变量：", "Required Environment: ") + step.requiredEnv.joined(separator: ", "))
                  .font(.caption).foregroundStyle(.secondary)
              }
            }
          }
        }
      }.frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
    }
  }

  private var history: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(text.copy("运行记录", "Run History")).font(.headline)
        Spacer()
        Button(text.copy("读取记录", "Reload History")) { Task { await model.refreshRuns() } }
      }
      if model.history.isEmpty { Text(text.copy("暂无运行记录", "No Runs Yet")).foregroundStyle(.secondary) }
      ForEach(model.history, id: \.id) { run in
        Button {
          model.openRun(run)
        } label: {
          HStack {
            Text(run.startedAt)
            Spacer()
            Text(status(run))
            if let code = run.exitCode { Text("exit \(code)").font(.system(.caption, design: .monospaced)) }
          }.contentShape(Rectangle())
        }.buttonStyle(.plain).disabled(!model.canChangeContext)
      }
    }
  }

  private func terminal(_ run: ProjectCommandRun) -> some View {
    VStack(spacing: 0) {
      HStack {
        Label(status(run), systemImage: "terminal")
        Text(run.command).lineLimit(1).help(([run.command] + run.args).joined(separator: " "))
        Text(run.id.prefix(8)).font(.caption).foregroundStyle(.secondary)
        Spacer()
        if let code = run.exitCode { Text("exit \(code)").font(.system(.caption, design: .monospaced)) }
        if run.truncated == true { Text(text.copy("历史输出已截断", "History Output Truncated")).font(.caption) }
        Button(text.copy("复制输出", "Copy Output")) {
          NSPasteboard.general.clearContents()
          NSPasteboard.general.setString(model.terminalOutput, forType: .string)
        }
        if run.isRunning {
          Button(text.copy("停止…", "Stop…")) { stopReview = true }
            .disabled(model.uncertain || model.stopping).accessibilityIdentifier("command.stop")
        }
      }.padding(10).background(.bar)
      if !model.outputOrderKnown {
        Text(
          text.copy(
            "历史记录分别保存标准输出与错误输出，以下按两部分显示。", "History stores stdout and stderr separately; they are shown in that order.")
        )
        .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 10)
      }
      if model.inputUncertain {
        HStack {
          Text(text.copy("输入送达结果不确定，请先检查输出。", "Input delivery is uncertain. Check the output first."))
          Button(text.copy("已核对，继续输入", "Checked, Resume Input")) { model.acknowledgeInputDelivery() }
        }.font(.caption).padding(8)
      }
      NativeTerminalView(session: model.terminalSession)
    }
  }

  private func status(_ run: ProjectCommandRun) -> String {
    switch run.status {
    case "running": text.copy("运行中", "Running")
    case "completed": text.copy("已完成", "Completed")
    case "cancelled": text.copy("已停止", "Stopped")
    default: text.copy("失败", "Failed")
    }
  }

  private func reviewSheet(_ review: ProjectCommandReview) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(text.copy("确认运行命令", "Confirm Command Run")).font(.title2)
      Text(review.capability.name).font(.headline)
      Text(review.project.path).textSelection(.enabled)
      ScrollView { invocationView(review.invocation) }.frame(maxHeight: 320)
      if review.requiresTrust {
        Text(
          text.copy(
            "此项目尚未信任。确认后将保存项目信任，并以你的本机权限运行项目代码。后续命令可使用这份信任。",
            "This project is untrusted. Confirmation saves project trust and runs its code with your local permissions. Future commands can use this trust."
          ))
      }
      Text(text.copy("取消不会授予信任或启动命令。", "Cancelling leaves trust unchanged and starts no command."))
        .font(.caption).foregroundStyle(.secondary)
      HStack {
        Spacer()
        Button(text.copy("取消", "Cancel")) { model.cancelReview() }.keyboardShortcut(.cancelAction)
          .accessibilityIdentifier("command.review.cancel")
        Button(review.requiresTrust ? text.copy("信任项目并运行", "Trust Project and Run") : text.copy("确认运行", "Confirm Run"))
        {
          Task { await model.confirmReview() }
        }.buttonStyle(.borderedProminent).disabled(model.busy)
          .accessibilityIdentifier("command.review.confirm")
      }
    }.padding(24).frame(width: 620).interactiveDismissDisabled(model.busy)
  }
}
