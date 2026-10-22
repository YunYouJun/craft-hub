import SwiftUI

/// The main window: a native sidebar and toolbar around the web workbench. The sidebar is a system list, so it
/// takes the system's sidebar material on every supported macOS version.
struct ContentView: View {
  @Bindable var model: WorkbenchModel
  let sidecar: RuntimeSidecar
  private let text = L10n.text

  var body: some View {
    NavigationSplitView {
      List(selection: $model.selection) {
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
    } detail: {
      detail
        .navigationTitle(model.selection?.title ?? "Craft Hub")
        .toolbar { toolbar }
    }
    .onChange(of: model.selection) { _, destination in model.select(destination) }
  }

  @ViewBuilder private var detail: some View {
    switch sidecar.state {
    case .ready(let url, _):
      WorkbenchWebView(url: url, model: model)
        .ignoresSafeArea(.container, edges: .top)
    case .resolving:
      StatusView(symbol: "magnifyingglass", title: text.findingNode, showsProgress: true)
    case .starting(let node):
      StatusView(symbol: "bolt.horizontal", title: text.starting, message: text.usingNode(node.path, node.version.description), showsProgress: true)
    case .missingNode:
      StatusView(symbol: "exclamationmark.triangle", title: text.missingNodeTitle, message: text.missingNodeMessage) {
        Button(text.chooseNode) { sidecar.chooseNode() }.buttonStyle(.borderedProminent)
        Button(text.retry) { sidecar.start() }
      }
    case .failed(let message):
      StatusView(symbol: "xmark.octagon", title: text.failedTitle, message: message) {
        Button(text.retry) { sidecar.start() }.buttonStyle(.borderedProminent)
      }
    }
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    ToolbarItemGroup(placement: .navigation) {
      Button(action: model.goBack) { Label(text.back, systemImage: "chevron.left") }
        .disabled(!model.canGoBack)
      Button(action: model.goForward) { Label(text.forward, systemImage: "chevron.right") }
        .disabled(!model.canGoForward)
    }
    ToolbarItemGroup(placement: .primaryAction) {
      Button { model.run("palette") } label: { Label(text.search, systemImage: "magnifyingglass") }
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
      }
      else {
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
