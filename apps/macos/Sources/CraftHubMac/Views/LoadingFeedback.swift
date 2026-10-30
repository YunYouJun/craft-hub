import SwiftUI

/// A single cancellable delay avoids flashing feedback for fast reads. No repeating timer or shimmer is used.
struct DelayedLoadingFeedback<Content: View>: View {
  let active: Bool
  let label: String
  @ViewBuilder let content: () -> Content
  @State private var revealed = false

  var body: some View {
    ZStack(alignment: .topLeading) {
      if active && revealed { content() }
    }
    .allowsHitTesting(false)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
    .accessibilityHidden(!active || !revealed)
    .task(id: active) {
      revealed = false
      guard active else { return }
      do {
        try await Task.sleep(for: .milliseconds(200))
        try Task.checkCancellation()
        revealed = true
      } catch {
        // Leaving the page or completing the read cancels its feedback.
      }
    }
  }
}

/// Noninteractive shapes describe layout, without inventing item counts, permissions or actions.
private struct SkeletonLine: View {
  var width: CGFloat? = nil
  var height: CGFloat = 12

  var body: some View {
    RoundedRectangle(cornerRadius: 4).fill(.quaternary)
      .frame(maxWidth: width, minHeight: height, maxHeight: height, alignment: .leading)
      .accessibilityHidden(true)
  }
}

struct ProjectDetailsSkeleton: View {
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        VStack(alignment: .leading, spacing: 10) {
          SkeletonLine(width: 230, height: 25)
          SkeletonLine()
          SkeletonLine(width: 360, height: 14)
          SkeletonLine(width: 300, height: 10)
        }.padding(.bottom, 6)
        HStack {
          SkeletonLine(width: 120, height: 17)
          Spacer()
          SkeletonLine(width: 110, height: 25)
        }
        VStack(spacing: 0) {
          ForEach(0..<4, id: \.self) { _ in
            HStack(alignment: .top, spacing: 12) {
              SkeletonLine(width: 20, height: 20)
              VStack(alignment: .leading, spacing: 8) {
                SkeletonLine(width: 210, height: 15)
                SkeletonLine(width: 360)
                SkeletonLine(width: 150, height: 10)
              }.frame(maxWidth: .infinity, alignment: .leading)
              SkeletonLine(width: 110, height: 25)
            }.padding(.vertical, 14)
            Divider()
          }
        }
      }.nativePageContent().padding(.bottom, 20)
    }
  }
}

struct SoftwareCatalogSkeleton: View {
  let columns: [GridItem]

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        SkeletonLine(width: 150)
        LazyVGrid(columns: columns, spacing: 12) {
          ForEach(0..<6, id: \.self) { _ in
            VStack(alignment: .leading, spacing: 12) {
              HStack(spacing: 10) {
                SkeletonLine(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 7) {
                  SkeletonLine(width: 150, height: 15)
                  SkeletonLine(width: 90, height: 10)
                }.frame(maxWidth: .infinity, alignment: .leading)
              }
              VStack(alignment: .leading, spacing: 7) {
                SkeletonLine()
                SkeletonLine(width: 180)
              }.frame(height: 34)
              HStack {
                SkeletonLine(width: 70, height: 10)
                Spacer()
                SkeletonLine(width: 65, height: 24)
              }.frame(height: 24)
            }.padding(14)
              .background(.quaternary.opacity(0.2), in: RoundedRectangle(cornerRadius: 12))
          }
        }
      }.nativePageContent().padding(.bottom, 20)
    }
  }
}
