import SwiftUI

/// System labels inherit the sidebar's selection, emphasis, and accessibility appearance.
struct SidebarDestinationLabel: View {
  let destination: Destination

  var body: some View {
    Label(destination.title, systemImage: destination.symbol)
  }
}
