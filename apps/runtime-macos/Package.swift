// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "CraftHubRuntime",
  platforms: [.macOS(.v13)],
  products: [
    .library(name: "RuntimeIPC", targets: ["RuntimeIPC"]),
    .executable(name: "CraftHubRuntimeBroker", targets: ["RuntimeBroker"]),
    .executable(name: "CraftHubRuntimeClient", targets: ["RuntimeClient"]),
  ],
  targets: [
    .target(name: "RuntimeIPC", swiftSettings: [.swiftLanguageMode(.v5)]),
    .executableTarget(name: "RuntimeBroker", dependencies: ["RuntimeIPC"], swiftSettings: [.swiftLanguageMode(.v5)]),
    .executableTarget(name: "RuntimeClient", dependencies: ["RuntimeIPC"], swiftSettings: [.swiftLanguageMode(.v5)]),
    .testTarget(name: "RuntimeIPCTests", dependencies: ["RuntimeIPC"], swiftSettings: [.swiftLanguageMode(.v5)]),
  ]
)
