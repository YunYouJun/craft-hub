// swift-tools-version: 6.0
import PackageDescription

// Prototype of the native macOS host from ADR 0012. The app owns the window chrome and runs the shared
// TypeScript runtime as a sidecar on the user's own Node.
let package = Package(
  name: "CraftHubMac",
  platforms: [.macOS(.v15)],
  products: [
    .executable(name: "CraftHubMac", targets: ["CraftHubMac"]),
  ],
  targets: [
    .target(name: "CraftHubMacCore", swiftSettings: [.swiftLanguageMode(.v5)]),
    .executableTarget(name: "CraftHubMac", dependencies: ["CraftHubMacCore"], swiftSettings: [.swiftLanguageMode(.v5)]),
    .testTarget(name: "CraftHubMacCoreTests", dependencies: ["CraftHubMacCore"], swiftSettings: [.swiftLanguageMode(.v5)]),
  ]
)
