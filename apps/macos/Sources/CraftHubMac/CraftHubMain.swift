import CraftHubMacCore
import Darwin
import SwiftUI

/// Maintenance must dispatch before AppDelegate constructs its normal profile lease and UI state.
@main
enum CraftHubMain {
  @MainActor static func main() async {
    switch IdentityMaintenanceEntry.mode(arguments: CommandLine.arguments) {
    case .application: CraftHubApp.main()
    case .recipient: exit(await IdentityMaintenanceEntry.run())
    case .rejected: exit(64)
    }
  }
}
