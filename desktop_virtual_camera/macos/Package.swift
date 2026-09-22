// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LunaVirtualCameraMacOS",
    platforms: [.macOS(.v12)],
    products: [
        .library(name: "LunaCameraShared", targets: ["LunaCameraShared"]),
    ],
    targets: [
        .target(name: "LunaCameraShared"),
    ]
)
