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

    // Windows: 使用 FFmpeg 进行解码和编码（支持 GPU 编码器如 nvenc/qsv/amf）
}
