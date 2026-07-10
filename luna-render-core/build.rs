extern crate napi_build;

fn main() {
    napi_build::setup();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/macos/av_bridge.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("luna_av_bridge");

        for framework in [
            "Foundation",
            "AVFoundation",
            "CoreMedia",
            "CoreVideo",
            "Metal",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
        println!("cargo:rerun-if-changed=src/macos/av_bridge.m");
    }

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        cc::Build::new()
            .file("src/windows/av_bridge.cpp")
            .cpp(true)
            .compile("luna_av_bridge");

        for lib in ["mfplat", "mfreadwrite", "mfuuid", "d3d11", "dxgi", "ole32"] {
            println!("cargo:rustc-link-lib={lib}");
        }
        println!("cargo:rerun-if-changed=src/windows/av_bridge.cpp");
    }
}
