import AppKit
import SwiftUI

/// The menu uses app-owned snapshots, so closing the main window never removes quick capture or navigation.
struct WorkbenchMenu: View {
  let delegate: AppDelegate
  private var model: WorkbenchModel { delegate.model }
  private var text: L10n { L10n.text }

  var body: some View {
    Button(text.copy("显示 Craft Hub", "Show Craft Hub")) { show() }
    Button(text.copy("快速记录", "Quick Capture")) { delegate.panels.showCapture() }
    Button(text.commandPalette) { delegate.panels.showPalette() }
    Divider()
    Section(text.copy("今日重点", "Today’s Focus")) {
      if let items = model.today.snapshot?.items, !items.isEmpty {
        ForEach(items.prefix(3)) { item in
          Button(Self.shortTitle(item.title)) {
            show()
            model.navigateToWebPath(item.path)
          }
        }
      } else {
        Button(text.copy("查看今日重点", "Open Today’s Focus")) {
          show()
          model.selection = .overview
          model.select(.overview)
        }
      }
    }
    Section(text.copy("最近项目", "Recent Projects")) {
      ForEach(model.recentProjects) { project in
        Button(Self.shortTitle(project.name)) {
          show()
          model.selectProject(project.id, capability: nil)
        }
      }
      Button(text.copy("浏览项目…", "Browse Projects…")) {
        show()
        model.selection = .projects
        model.select(.projects)
      }
    }
    Divider()
    Button(text.settings) {
      show()
      model.run("settings")
    }
    Button(text.copy("退出 Craft Hub", "Quit Craft Hub")) { NSApp.terminate(nil) }.keyboardShortcut("q")
  }

  private func show() {
    delegate.panels.showMainWindow()
    NSApp.activate(ignoringOtherApps: true)
  }

  static func shortTitle(_ title: String) -> String {
    title.count <= 30 ? title : String(title.prefix(29)) + "…"
  }
}
