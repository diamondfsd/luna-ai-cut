extern crate napi_build;

use std::path::PathBuf;

fn main() {
    napi_build::setup();
    println!("cargo:rustc-check-cfg=cfg(luna_ffmpeg_shared)");

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

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        configure_windows_ffmpeg_bridge();
    }
}

fn configure_windows_ffmpeg_bridge() {
    let manifest = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let default_root = manifest
        .parent()
        .unwrap_or(&manifest)
        .join(".ffmpeg-cache")
        .join("ffmpeg-8.1.2-full_build-shared")
        .join("ffmpeg-8.1.2-full_build-shared");
    let root = std::env::var_os("LUNA_FFMPEG_SHARED_ROOT")
        .map(PathBuf::from)
        .unwrap_or(default_root);
    let include = root.join("include");
    let library = root.join("lib");
    if !include.join("libavcodec/avcodec.h").is_file() || !library.join("avcodec.lib").is_file() {
        println!(
            "cargo:warning=FFmpeg shared development files not found at {}; in-process D3D11VA decode is disabled",
            root.display()
        );
        return;
    }

    cc::Build::new()
        .cpp(true)
        .file("src/windows/ffmpeg_d3d11_bridge.cpp")
        .include(&include)
        .flag_if_supported("/std:c++17")
        .compile("luna_ffmpeg_d3d11_bridge");
    println!("cargo:rustc-cfg=luna_ffmpeg_shared");
    println!("cargo:rustc-link-search=native={}", library.display());
    for name in ["avformat", "avcodec", "avutil"] {
        println!("cargo:rustc-link-lib=dylib={name}");
    }
    copy_windows_ffmpeg_runtime(&root);
    println!("cargo:rerun-if-env-changed=LUNA_FFMPEG_SHARED_ROOT");
    println!("cargo:rerun-if-changed=src/windows/ffmpeg_d3d11_bridge.cpp");
    println!("cargo:rerun-if-changed=src/windows/ffmpeg_d3d11_bridge.h");
}

fn copy_windows_ffmpeg_runtime(root: &std::path::Path) {
    let Some(profile_dir) = std::env::var_os("OUT_DIR")
        .map(PathBuf::from)
        .and_then(|path| path.ancestors().nth(3).map(PathBuf::from))
    else {
        return;
    };
    let bin = root.join("bin");
    for name in [
        "avformat-62.dll",
        "avcodec-62.dll",
        "avutil-60.dll",
        "swresample-6.dll",
    ] {
        let source = bin.join(name);
        let destination = profile_dir.join(name);
        if source.is_file() {
            let should_copy = std::fs::metadata(&destination)
                .ok()
                .zip(std::fs::metadata(&source).ok())
                .is_none_or(|(destination, source)| destination.len() != source.len());
            if should_copy {
                std::fs::copy(&source, &destination).unwrap_or_else(|error| {
                    panic!(
                        "failed to copy {} to {}: {error}",
                        source.display(),
                        destination.display()
                    )
                });
            }
            println!("cargo:rerun-if-changed={}", source.display());
        }
    }
}
