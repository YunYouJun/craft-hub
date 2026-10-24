import SwiftUI

struct CommandPaletteView: View {
  @Bindable var model: CommandPaletteModel
  let choose: (CommandPaletteModel.Item) -> Void
  let dismiss: () -> Void
  private var text: L10n { L10n.text }

  var body: some View {
    VStack(spacing: 0) {
      searchBar
      Divider()
      results
      Divider()
      footer
    }
    .frame(width: 680, height: 510)
    .background(Color(nsColor: .windowBackgroundColor).opacity(0.9), in: RoundedRectangle(cornerRadius: 16))
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
    .clipShape(RoundedRectangle(cornerRadius: 16))
    .overlay {
      RoundedRectangle(cornerRadius: 16)
        .strokeBorder(.primary.opacity(0.1), lineWidth: 1)
        .allowsHitTesting(false)
    }
    .onChange(of: model.query) { model.selectedID = nil }
    .onChange(of: model.category) {
      model.selectedID = nil
      model.focus = UUID()
    }
    .onExitCommand(perform: dismiss)
  }

  private var searchBar: some View {
    HStack(spacing: 14) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 20, weight: .regular))
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)
      PaletteSearchField(
        text: $model.query,
        placeholder: text.copy("搜索页面、项目、命令和技能…", "Search pages, projects, commands, skills…"), focus: model.focus,
        move: { model.move($0) }, submit: { if let selected = model.selected { choose(selected) } }, dismiss: dismiss
      )
      .frame(height: 28)
      if !model.query.isEmpty {
        Button {
          model.query = ""
          model.focus = UUID()
        } label: {
          Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(text.copy("清除搜索", "Clear search"))
        .help(text.copy("清除搜索", "Clear search"))
      }
      Picker(text.copy("搜索范围", "Search scope"), selection: $model.category) {
        ForEach(CommandPaletteModel.Category.allCases) { category in Text(category.title).tag(category) }
      }
      .pickerStyle(.menu)
      .labelsHidden()
      .fixedSize()
      .accessibilityIdentifier("palette.category")
      Button(action: dismiss) { PaletteKeycap(key: "esc") }
        .buttonStyle(.plain)
        .help(text.copy("关闭搜索", "Close search"))
        .accessibilityLabel(text.copy("关闭搜索", "Close search"))
    }
    .padding(.horizontal, 22)
    .frame(height: 76)
  }

  private var results: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(spacing: 2) {
          ForEach(model.results) { item in
            resultRow(item)
          }
          if model.results.isEmpty {
            ContentUnavailableView.search(text: model.query).padding(.top, 48)
          }
        }
        .padding(8)
      }
      .onChange(of: model.selectedID) { _, value in if let value { proxy.scrollTo(value) } }
    }
  }

  private func resultRow(_ item: CommandPaletteModel.Item) -> some View {
    let selected = item.id == model.selected?.id
    return Button {
      choose(item)
    } label: {
      HStack(spacing: 12) {
        Image(systemName: item.symbol)
          .font(.system(size: 17))
          .frame(width: 30, height: 30)
          .foregroundStyle(.secondary)
        VStack(alignment: .leading, spacing: 3) {
          Text(item.title).font(.system(size: 13, weight: .medium)).lineLimit(1)
          Text(item.subtitle).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
        }
        Spacer(minLength: 16)
        if item.isPinned {
          Image(systemName: "pin.fill")
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
            .accessibilityLabel(text.copy("已置顶", "Pinned"))
        }
        Text(item.category.title).font(.system(size: 11)).foregroundStyle(.tertiary)
        Image(systemName: "return")
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(.secondary)
          .opacity(selected ? 1 : 0)
          .accessibilityHidden(true)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 9)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .background(selected ? Color.primary.opacity(0.07) : .clear, in: RoundedRectangle(cornerRadius: 8))
    .accessibilityAddTraits(selected ? [.isSelected] : [])
    .id(item.id)
  }

  private var footer: some View {
    HStack(spacing: 8) {
      if model.loading {
        ProgressView().controlSize(.small)
          .help(text.copy("正在更新索引…", "Updating index…"))
      } else {
        Button {
          model.refresh()
        } label: {
          Image(systemName: "arrow.clockwise").frame(width: 20, height: 20)
        }
        .buttonStyle(.plain)
        .help(text.copy("刷新索引", "Refresh index"))
        .accessibilityLabel(text.copy("刷新索引", "Refresh index"))
      }
      Text(model.error ?? text.copy("> 筛选命令 · 项目:命令", "> Commands · project:command"))
        .lineLimit(1)
        .help(model.error ?? text.copy("输入 > 筛选命令，或输入 项目:命令", "Type > to filter commands, or project:command"))
      Spacer(minLength: 12)
      HStack(spacing: 4) {
        PaletteKeycap(key: "↑")
        PaletteKeycap(key: "↓")
        Text(text.copy("选择", "Select")).padding(.leading, 2)
      }
      HStack(spacing: 6) {
        PaletteKeycap(key: "↵")
        Text(text.copy("打开", "Open"))
      }.padding(.leading, 8)
    }
    .font(.system(size: 11))
    .foregroundStyle(.secondary)
    .padding(.horizontal, 16)
    .frame(height: 42)
  }
}

private struct PaletteKeycap: View {
  let key: String

  var body: some View {
    Text(key)
      .font(.system(size: 10, weight: .medium, design: .monospaced))
      .foregroundStyle(.secondary)
      .padding(.horizontal, 5)
      .frame(minWidth: 20, minHeight: 20)
      .background(.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 4))
      .overlay {
        RoundedRectangle(cornerRadius: 4).strokeBorder(.primary.opacity(0.08), lineWidth: 0.5)
      }
  }
}
