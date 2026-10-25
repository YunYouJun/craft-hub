import SwiftUI

/// Personal launch shortcuts share the runtime's favorites with the software catalog.
struct ToolsView: View {
  let model: SoftwareFavoritesModel
  let navigation: WebsiteNavigationModel
  let page: ToolsPage
  let findRequest: Int
  let navigate: (String) -> Void
  private var text: L10n { L10n.text }

  var body: some View {
    if page == .navigation {
      WebsiteNavigationView(model: navigation, findRequest: findRequest, navigate: navigate)
    } else {
      favorites
    }
  }

  private var favorites: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        VStack(alignment: .leading, spacing: 5) {
          Text(text.copy("常用工具", "Favorite Tools")).font(.largeTitle.bold())
          Text(text.copy("收藏常用网站和本机应用，按分组快速打开。", "Keep favorite websites and local apps together for quick access."))
            .foregroundStyle(.secondary)
        }
        Spacer()
        Button(text.copy("网站导航", "Website Directory")) { navigate("/navigation") }
        Button(text.copy("软件中心", "Software")) { navigate("/software") }
          .help(text.copy("发现软件、查看安装状态和管理安装", "Discover software, check installation status and manage installations"))
      }.padding(24)
      SoftwareFavoritesView(model: model, findRequest: findRequest)
    }
    .task { await model.load() }
  }
}
