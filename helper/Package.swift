// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "StorageHelper",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "StorageHelper", targets: ["StorageHelper"]),
        .executable(name: "Storage Studio KH Helper", targets: ["StorageHelperCLI"]),
    ],
    targets: [
        .target(
            name: "StorageHelper",
            linkerSettings: [
                .linkedFramework("Security"),
                .linkedFramework("Network"),
                .linkedFramework("CoreFoundation"),
            ]
        ),
        .executableTarget(name: "StorageHelperCLI", dependencies: ["StorageHelper"]),
        .testTarget(name: "StorageHelperTests", dependencies: ["StorageHelper"]),
    ]
)
