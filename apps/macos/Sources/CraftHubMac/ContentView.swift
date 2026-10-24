import SwiftUI

/// The main window: a native sidebar and toolbar around the web workbench. The sidebar is a system list, so it
/// takes the system's sidebar material on every supported macOS version.
struct ContentView: View {
  @Bindable var model: WorkbenchModel
  let sidecar: RuntimeSidecar
  private var text: L10n { L10n.text }

  var body: some View {
    NavigationSplitView {
      List(
        selection: Binding(
          get: { model.selection },
          set: {
            model.selection = $0
            model.select($0)
          })
      ) {
        Section {
          ForEach(Destination.primary) { destination in
            Label(destination.title, systemImage: destination.symbol).tag(destination)
          }
        }
        Section(text.manageSection) {
          ForEach(Destination.manage) { destination in
            Label(destination.title, systemImage: destination.symbol).tag(destination)
          }
        }
      }
      .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 280)
      .dropDestination(for: URL.self) { urls, _ in
        guard urls.contains(where: \.isFileURL) else { return false }
        model.importProjects?(urls)
        return true
      }
      .onAppear { PerformanceTrace.mark(.sidebarAppeared) }
    } detail: {
      detail
        .navigationTitle(model.selection?.title ?? "Craft Hub")
        .toolbar { toolbar }
    }
    .alert(
      text.copy("无法打开链接", "Could Not Open Link"),
      isPresented: Binding(
        get: { model.navigationError != nil }, set: { if !$0 { model.navigationError = nil } }
      )
    ) {
      Button(text.copy("好", "OK")) { model.navigationError = nil }
    } message: {
      Text(model.navigationError ?? "")
    }
  }

  @ViewBuilder private var detail: some View {
    switch sidecar.state {
    case .ready(let connection, let node):
      VStack(spacing: 0) {
        if !model.cloud.approvals.isEmpty {
          Button(
            text.copy(
              "有 \(model.cloud.approvals.count) 个个人云远程请求待审阅",
              "\(model.cloud.approvals.count) Personal Cloud Requests Await Review")
          ) {
            model.presentSettings?()
            model.cloud.reviewPresented = true
          }.padding(8)
        }
        if model.observation.state == .reconnecting {
          Text(text.copy("实时更新正在重连，显示的数据可能已过期。", "Reconnecting live updates; displayed data may be stale."))
            .font(.caption).foregroundStyle(.secondary).padding(8)
        }
        if let message = sidecar.nodeSelectionMessage {
          Text(message).font(.caption).foregroundStyle(.secondary).padding(8).textSelection(.enabled)
        }
        if let message = sidecar.recoveryMessage {
          Text(message).font(.caption).foregroundStyle(.secondary).padding(8)
        }
        ZStack {
          // Keep one bootstrapped web view alive while native pages are visible, preserving web drafts and history.
          WorkbenchWebView(url: connection.bootstrapURL, model: model)
            .id(connection.origin)
            .opacity(model.presentsNativeContent ? 0 : 1)
            .allowsHitTesting(!model.presentsNativeContent)
            .accessibilityHidden(model.presentsNativeContent)
          if model.presentsNativeContent {
            if model.selection == .overview {
              TodayFocusView(
                today: model.today, capture: { model.run("capture") }, navigate: model.navigateToWebPath,
                showWorkbench: model.showWebWorkbench
              )
              .onAppear { PerformanceTrace.mark(.nativePageAppeared) }
            } else if model.selection == .projects {
              ProjectsView(
                projects: model.projects, findRequest: model.findRequest,
                openProject: { model.selectProject($0, capability: nil) },
                showWorkbench: model.showWebWorkbench
              )
              .onAppear { PerformanceTrace.mark(.nativePageAppeared) }
            } else if model.selection == .marketplace {
              PluginsView(
                model: model.plugins, findRequest: model.findRequest,
                restart: {
                  guard let restart = model.restartRuntime else { return }
                  try await restart()
                }
              ).onAppear { PerformanceTrace.mark(.nativePageAppeared) }
            } else if model.selection == .diagnostics {
              DiagnosticsView(
                model: model.diagnostics, findRequest: model.findRequest, node: node, openTarget: model.openDiagnostic
              )
              .onAppear { PerformanceTrace.mark(.nativePageAppeared) }
            } else if model.selection == .workbenches {
              IntegrationWorkbenchView(
                model: model.integrations, projects: model.projects.projects, findRequest: model.findRequest,
                openWeb: model.showIntegrationWeb, openConfiguration: model.openConfiguration
              )
              .onAppear { PerformanceTrace.mark(.nativePageAppeared) }
            } else if model.selection == .environment, let machine = model.machine {
              EnvironmentView(
                machine: machine, openWeb: model.navigateToWebPath,
                openSoftware: {
                  model.selection = .software
                  model.select(.software)
                },
                openConfiguration: model.openConfiguration
              )
              .onAppear { PerformanceTrace.mark(.nativePageAppeared) }
            } else if let machine = model.machine {
              SoftwareView(machine: machine, findRequest: model.findRequest, showWorkbench: model.showWebWorkbench)
                .onAppear { PerformanceTrace.mark(.nativePageAppeared) }
            }
          }
        }
      }
    case .resolving:
      StatusView(symbol: "magnifyingglass", title: text.findingNode, showsProgress: true)
    case .starting(let node):
      StatusView(
        symbol: "bolt.horizontal", title: text.starting, message: text.usingNode(node.path, node.version.description),
        showsProgress: true)
    case .missingNode:
      StatusView(
        symbol: "exclamationmark.triangle", title: text.missingNodeTitle,
        message: [
          sidecar.nodeSelectionMessage, text.missingNodeMessage, sidecar.loginPathError,
          text.copy(
            "“读取登录 PATH”会运行一次 zsh/bash 的非交互登录启动文件，最多 5 秒。",
            "Read Login PATH runs your zsh/bash noninteractive login startup files once, for at most 5 seconds."),
        ].compactMap { $0 }.joined(separator: "\n\n")
      ) {
        VStack(spacing: 14) {
          HStack {
            Button(text.chooseNode) { sidecar.chooseNode() }.buttonStyle(.borderedProminent).disabled(
              sidecar.privateNode.busy || sidecar.readingLoginPath)
            Button(text.copy("读取登录 PATH", "Read Login PATH")) { sidecar.readLoginPath() }.disabled(
              sidecar.readingLoginPath || sidecar.privateNode.busy)
            Button(text.retry) { sidecar.start() }.disabled(sidecar.privateNode.busy || sidecar.readingLoginPath)
            if sidecar.readingLoginPath { ProgressView().controlSize(.small) }
          }
          PrivateNodeControls(sidecar: sidecar)
        }.frame(maxWidth: 520)
      }
    case .failed(let message):
      StatusView(symbol: "xmark.octagon", title: text.failedTitle, message: message) {
        VStack(spacing: 14) {
          Button(text.retry) { sidecar.start() }.buttonStyle(.borderedProminent).disabled(sidecar.privateNode.busy)
          PrivateNodeControls(sidecar: sidecar)
        }.frame(maxWidth: 520)
      }
    }
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    ToolbarItemGroup(placement: .navigation) {
      Button(action: model.goBack) { Label(text.back, systemImage: "chevron.left") }
        .disabled(model.presentsNativeContent || !model.canGoBack)
      Button(action: model.goForward) { Label(text.forward, systemImage: "chevron.right") }
        .disabled(model.presentsNativeContent || !model.canGoForward)
    }
    ToolbarItemGroup(placement: .primaryAction) {
      if model.selection?.isNative == true && model.showsWebContent {
        Button {
          model.select(model.selection)
        } label: {
          Label(text.copy("返回列表", "Back to List"), systemImage: "list.bullet")
        }
      }
      Button {
        model.run("palette")
      } label: {
        Label(text.search, systemImage: "magnifyingglass")
      }
      .help(text.search)
      Button(action: model.reload) { Label(text.reload, systemImage: "arrow.clockwise") }
        .help(text.reload)
    }
  }
}

/// A native placeholder shown while the runtime starts or when it cannot start, so the window is never blank.
struct StatusView<Actions: View>: View {
  let symbol: String
  let title: String
  var message: String?
  var showsProgress = false
  @ViewBuilder var actions: () -> Actions

  var body: some View {
    VStack(spacing: 14) {
      if showsProgress {
        ProgressView().controlSize(.large)
      } else {
        Image(systemName: symbol).font(.system(size: 34, weight: .regular)).foregroundStyle(.secondary)
      }
      Text(title).font(.title3.weight(.semibold))
      if let message {
        Text(message)
          .font(.callout)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
          .textSelection(.enabled)
          .frame(maxWidth: 460)
      }
      HStack { actions() }.padding(.top, 4)
    }
    .padding(32)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

extension StatusView where Actions == EmptyView {
  init(symbol: String, title: String, message: String? = nil, showsProgress: Bool = false) {
    self.init(symbol: symbol, title: title, message: message, showsProgress: showsProgress) { EmptyView() }
  }
}
