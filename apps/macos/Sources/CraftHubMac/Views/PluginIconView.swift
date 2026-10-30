import AppKit
import CraftHubMacCore
import SwiftUI

/// A provider-neutral icon for plugins and their contribution sources; missing or invalid artwork keeps a stable fallback.
struct PluginIconView: View {
  private struct Request: Hashable {
    let artwork: PluginArtwork
    let client: ObjectIdentifier?
    let revision: Int
  }
  private struct Loaded {
    let request: Request
    let image: NSImage
  }
  let artwork: PluginArtwork
  let client: RuntimeAPIClient?
  let revision: Int
  let fallbackSymbol: String
  let size: CGFloat
  @State private var loaded: Loaded?
  private var hasTile: Bool { size >= 28 }
  private var request: Request {
    Request(artwork: artwork, client: client.map(ObjectIdentifier.init), revision: revision)
  }

  init(
    artwork: PluginArtwork, client: RuntimeAPIClient? = nil, revision: Int = 0,
    fallbackSymbol: String = "puzzlepiece.extension", size: CGFloat = 32
  ) {
    self.artwork = artwork
    self.client = client
    self.revision = revision
    self.fallbackSymbol = fallbackSymbol
    self.size = size
  }

  init(icon: String?, fallbackSymbol: String = "puzzlepiece.extension", size: CGFloat = 32) {
    self.init(artwork: PluginArtwork(icon: icon), fallbackSymbol: fallbackSymbol, size: size)
  }

  var body: some View {
    ZStack {
      if let loaded, loaded.request == request {
        Image(nsImage: loaded.image).renderingMode(.original).resizable().scaledToFit()
      } else {
        let fallback = Image(systemName: fallbackSymbol).font(.system(size: size * (hasTile ? 0.52 : 0.7)))
        if hasTile {
          fallback.foregroundStyle(Color(nsColor: .secondaryLabelColor))
        } else {
          fallback.foregroundStyle(.secondary)
        }
      }
    }.padding(hasTile ? size * 0.14 : 0)
      .frame(width: size, height: size)
      .background {
        if hasTile {
          RoundedRectangle(cornerRadius: size * 0.25, style: .continuous)
            .fill(Color(nsColor: .controlBackgroundColor))
        }
      }
      .overlay {
        if hasTile {
          RoundedRectangle(cornerRadius: size * 0.25, style: .continuous)
            .strokeBorder(Color(nsColor: .separatorColor).opacity(0.6), lineWidth: 0.5)
        }
      }.accessibilityHidden(true)
      .task(id: request) {
        let requested = request
        let image = await PluginIconCache.shared.image(for: artwork, client: client, revision: revision)
        guard !Task.isCancelled, requested == request else { return }
        loaded = image.map { Loaded(request: requested, image: $0) }
      }
  }
}

/// A collection tile made from the included plugins rather than the pack's publisher logo.
struct PluginPackIconView: View {
  let members: [PluginPackMember]
  let client: RuntimeAPIClient?
  let revision: Int
  var size: CGFloat = 44

  var body: some View {
    LazyVGrid(columns: [GridItem(.flexible(), spacing: 2), GridItem(.flexible(), spacing: 2)], spacing: 2) {
      ForEach(Array(members.prefix(4))) { member in
        PluginIconView(artwork: member.artwork, client: client, revision: revision, size: (size - 8) / 2)
      }
    }.padding(3).frame(width: size, height: size, alignment: .topLeading)
      .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: size * 0.22))
      .overlay(
        RoundedRectangle(cornerRadius: size * 0.22).strokeBorder(
          Color(nsColor: .separatorColor).opacity(0.6), lineWidth: 0.5)
      )
      .overlay(alignment: .bottomTrailing) {
        if members.count > 4 {
          Text("+\(members.count - 4)").font(.system(size: 9, weight: .semibold))
            .padding(2).background(.background, in: Capsule()).offset(x: 3, y: 3)
        }
      }.accessibilityHidden(true)
  }
}

struct PluginPackMembersView: View {
  @Bindable var model: PluginsModel
  let members: [PluginPackMember]
  private var text: L10n { .text }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(text.copy("包含 \(members.count) 个插件", "Includes \(members.count) plugins"))
        .font(.caption).foregroundStyle(.secondary)
      ForEach(members) { member in
        Button {
          if let version = member.version {
            model.detail = .init(source: member.sourceId, package: member.package, version: version)
          }
        } label: {
          HStack(spacing: 8) {
            PluginIconView(artwork: member.artwork, client: model.iconClient, revision: model.iconRevision, size: 20)
            Text(member.name(chinese: text.chinese)).lineLimit(1)
            Spacer()
            Text(member.version ?? member.range).foregroundStyle(.secondary)
            if member.error != nil || member.status == "blocked" {
              Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
            } else if member.installed {
              Text(member.enabled == true ? text.copy("已启用", "Enabled") : text.copy("已停用", "Disabled"))
                .foregroundStyle(.secondary)
            } else if member.version == nil {
              Text(text.copy("来源中不可用", "Unavailable from source")).foregroundStyle(.secondary)
            }
          }.font(.caption)
        }.buttonStyle(.plain).disabled(member.version == nil)
      }
    }
  }
}
