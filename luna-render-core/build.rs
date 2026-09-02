extern crate napi_build;

fn main() {
    napi_build::setup();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/macos/av_bridge.m")
            .file("src/macos/preview_surface.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("luna_av_bridge");

        for framework in [
            "Foundation",
            "AppKit",
            "AVFoundation",
            "CoreMedia",
            "CoreVideo",
            "Metal",
            "QuartzCore",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
        println!("cargo:rerun-if-changed=src/macos/av_bridge.m");
        println!("cargo:rerun-if-changed=src/macos/preview_surface.m");
    }

    // Windows native video work uses windows-rs for D3D12 and Media Foundation.
    // No C/C++ bridge is required; unsupported machines use the Rust FFmpeg fallback.
}
