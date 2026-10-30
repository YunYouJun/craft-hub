// swift-tools-version: 6.0
import PackageDescription

// Prototype of the native macOS host from ADR 0012. The app owns the window chrome and runs the shared
// TypeScript runtime as a sidecar on the user's own Node.
let package = Package(
  name: "CraftHubMac",
  platforms: [.macOS(.v15)],
  products: [
    .executable(name: "CraftHubMac", targets: ["CraftHubMac"])
  ],
  dependencies: [
    .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.0")
  ],
  targets: [
    .target(name: "CraftHubIdentityIPC", linkerSettings: [.linkedLibrary("bsm")]),
    .target(name: "CraftHubMacCore", dependencies: ["CraftHubIdentityIPC"], swiftSettings: [.swiftLanguageMode(.v5)]),
    .executableTarget(
      name: "CraftHubMac", dependencies: ["CraftHubMacCore", .product(name: "Sparkle", package: "Sparkle")],
      resources: [.copy("Resources/EnvironmentTools"), .copy("Resources/BrowserImport")],
      swiftSettings: [.swiftLanguageMode(.v5)],
      linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]),
    .testTarget(
      name: "CraftHubMacCoreTests", dependencies: ["CraftHubMacCore"], swiftSettings: [.swiftLanguageMode(.v5)]),
    .testTarget(
      name: "CraftHubMacTests", dependencies: ["CraftHubMac", "CraftHubMacCore"],
      swiftSettings: [.swiftLanguageMode(.v5)]),
  ]
)
