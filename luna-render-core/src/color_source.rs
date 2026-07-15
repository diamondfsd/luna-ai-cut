use napi_derive::napi;

/// 素材颜色信息（分层检测：HDR ↔ 宽色域 ↔ 高位深，互不混淆）
#[napi(object)]
pub struct ColorInfo {
    pub is_hdr: bool,
    pub is_wide_gamut: bool,
    pub is_high_bit_depth: bool,
    pub color_primaries: String,
    pub color_transfer: String,
    pub color_space: String,
    pub bit_depth: u32,
    pub width: u32,
    pub height: u32,
}

fn contains_any(s: &str, keys: &[&str]) -> bool {
    let lower = s.to_lowercase();
    keys.iter().any(|k| lower.contains(k))
}

/// 解析后的渲染源
#[napi(object)]
pub struct ResolvedRenderSource {
    pub render_path: String,
    pub normalized: bool,
    pub width: u32,
    pub height: u32,
    pub color_primaries: String,
    pub color_transfer: String,
}

/// 检测素材颜色信息
fn probe_color_info(ffprobe: &str, path: &str) -> Result<ColorInfo, String> {
    use crate::media::command;

    let output = command(ffprobe)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-show_frames",
            "-read_intervals",
            "%+#1",
            path,
        ])
        .output()
        .map_err(|e| format!("ffprobe: {}", e))?;
    if !output.status.success() {
        return Err(format!("ffprobe exit: {}", output.status));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    crate::log!("resolve_render_source: ffprobe output: {}", stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("json: {}", e))?;
    let streams = parsed["streams"].as_array().ok_or("no streams")?;
    let vs = streams
        .iter()
        .find(|s| s["codec_type"].as_str() == Some("video"))
        .ok_or("no video stream")?;
    let frames = parsed["frames"].as_array();

    let w = vs["width"].as_u64().unwrap_or(0) as u32;
    let h = vs["height"].as_u64().unwrap_or(0) as u32;
    let primaries = vs["color_primaries"].as_str().unwrap_or("").to_string();
    let transfer = vs["color_transfer"].as_str().unwrap_or("").to_string();
    let colorspace = vs["color_space"].as_str().unwrap_or("").to_string();
    let bit_depth = vs["bits_per_raw_sample"].as_u64().unwrap_or(8) as u32;

    // ── 传输函数判断（HDR 强信号）──
    let is_pq = contains_any(
        &transfer,
        &[
            "2084",
            "smpte2084",
            "smpte st 2084",
            "pq",
            "perceptual quantizer",
        ],
    );
    let is_hlg = contains_any(&transfer, &["hlg", "arib", "b67", "arib-std-b67"]);

    // ── 色域判断 ──
    let is_bt2020 = contains_any(&primaries, &["2020", "bt2020", "bt.2020", "rec.2020"]);
    let is_display_p3 = contains_any(&primaries, &["p3", "display-p3", "display p3", "dcip3"]);

    // ── Gain Map / Adaptive Gain Curve 检测 ──
    let mut has_gain_map = false;
    let mut has_adaptive_gain_curve = false;
    if let Some(frames_arr) = frames {
        for frame in frames_arr {
            if let Some(tags) = frame["tags"].as_object() {
                for (k, v) in tags {
                    let key = k.to_lowercase();
                    let val = v.as_str().unwrap_or("").to_lowercase();
                    if key.contains("gain") || val.contains("gain") {
                        has_gain_map = true;
                    }
                    if key.contains("adaptive") || val.contains("adaptive") {
                        has_adaptive_gain_curve = true;
                    }
                }
            }
            if let Some(sd_list) = frame["side_data_list"].as_array() {
                for sd in sd_list {
                    if let Some(st) = sd["side_data_type"].as_str() {
                        let stl = st.to_lowercase();
                        if stl.contains("gain") || stl.contains("hdr") {
                            has_gain_map = true;
                        }
                        if stl.contains("adaptive") {
                            has_adaptive_gain_curve = true;
                        }
                    }
                }
            }
        }
    }

    // ── 分层结果 ──
    let is_hdr_transfer = is_pq || is_hlg;
    let is_wide_gamut = is_bt2020 || is_display_p3;
    let is_high_bit_depth = bit_depth > 8;
    let is_hdr = is_hdr_transfer || has_gain_map || has_adaptive_gain_curve;

    Ok(ColorInfo {
        is_hdr,
        is_wide_gamut,
        is_high_bit_depth,
        color_primaries: primaries,
        color_transfer: transfer,
        color_space: colorspace,
        bit_depth,
        width: w,
        height: h,
    })
}

/// 统一解析渲染源：检测 HDR / 宽色域并自动 normalize 为 SDR sRGB 中间图
///
/// - 普通 SDR sRGB：直接返回原路径
/// - 宽色域 SDR（P3/BT.2020）：只做色域转换，不做 tone mapping
/// - HDR（PQ/HLG/GainMap）：HDR→SDR tone mapping + 色域转换
///
/// 预览和导出都应使用 renderPath，保证颜色一致。
#[napi]
pub fn resolve_render_source(
    ffmpeg_path: String,
    ffprobe_path: String,
    original_path: String,
    cache_dir: String,
) -> napi::Result<ResolvedRenderSource> {
    use crate::media::command;
    use std::path::Path;
    use std::process::Stdio;

    crate::log!(
        "resolve_render_source: input path={} cache={}",
        original_path,
        cache_dir
    );

    let color_info = probe_color_info(&ffprobe_path, &original_path)
        .map_err(|e| napi::Error::from_reason(format!("探测颜色信息失败: {}", e)))?;

    crate::log!("resolve_render_source: color_info is_hdr={} is_wide_gamut={} is_high_bit_depth={} primaries={} transfer={} colorspace={} bit_depth={} size={}x{}",
        color_info.is_hdr, color_info.is_wide_gamut, color_info.is_high_bit_depth,
        color_info.color_primaries, color_info.color_transfer, color_info.color_space,
        color_info.bit_depth, color_info.width, color_info.height);

    // 普通 sRGB SDR → 直接返回原路径
    if !color_info.is_hdr && !color_info.is_wide_gamut {
        crate::log!("resolve_render_source: sRGB SDR, using original path");
        return Ok(ResolvedRenderSource {
            render_path: original_path.clone(),
            normalized: false,
            width: color_info.width,
            height: color_info.height,
            color_primaries: color_info.color_primaries,
            color_transfer: color_info.color_transfer,
        });
    }

    // 生成缓存文件名（基于原始路径 hash）
    use std::hash::{Hash, Hasher};
    let cache_dir = Path::new(&cache_dir).join("color-normalized");
    let _ = std::fs::create_dir_all(&cache_dir);

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    original_path.hash(&mut hasher);
    let hash = hasher.finish();

    let cache_path = cache_dir.join(format!("{:016x}_sdr_srgb.png", hash));
    let cache_str = cache_path.to_string_lossy().to_string();

    crate::log!("resolve_render_source: checking cache {}", cache_str);
    if cache_path.exists() {
        crate::log!("resolve_render_source: cache HIT");
        return Ok(ResolvedRenderSource {
            render_path: cache_str,
            normalized: true,
            width: color_info.width,
            height: color_info.height,
            color_primaries: "bt709".to_string(),
            color_transfer: "bt709".to_string(),
        });
    }

    // ── 构造 ffmpeg normalize 命令 ──
    let zscale_available = command(&ffmpeg_path)
        .args(["-filters"])
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .output()
        .map(|o| {
            let avail = String::from_utf8_lossy(&o.stderr).contains("zscale");
            crate::log!("resolve_render_source: zscale_available={}", avail);
            avail
        })
        .unwrap_or(false);

    let mut cmd = command(&ffmpeg_path);
    cmd.args(["-y", "-i", &original_path]);

    let mut cmd_log = format!("{} -y -i {}", ffmpeg_path, original_path);

    if color_info.is_hdr {
        crate::log!(
            "resolve_render_source: HDR detected, tone mapping {} → {}",
            original_path,
            cache_str
        );
        if zscale_available {
            cmd.args(["-vf", "zscale=transfer=linear,tonemap=hable,zscale=transfer=bt709:p=bt709:m=bt709,format=rgb24"]);
            cmd_log += " -vf zscale=transfer=linear,tonemap=hable,zscale=transfer=bt709:p=bt709:m=bt709,format=rgb24";
        } else {
            crate::log!("resolve_render_source: zscale not available, using basic conversion");
            cmd.args([
                "-vf",
                "setparams=color_primaries=bt709:color_trc=bt709,format=rgb24",
            ]);
            cmd_log += " -vf setparams=color_primaries=bt709:color_trc=bt709,format=rgb24";
        }
    } else if color_info.is_wide_gamut {
        crate::log!(
            "resolve_render_source: wide gamut SDR detected, gamut convert {} → {}",
            original_path,
            cache_str
        );
        if zscale_available {
            cmd.args(["-vf", "zscale=p=bt709:t=bt709:m=bt709,format=rgb24"]);
            cmd_log += " -vf zscale=p=bt709:t=bt709:m=bt709,format=rgb24";
        } else {
            cmd.args([
                "-vf",
                "setparams=color_primaries=bt709:color_trc=bt709,format=rgb24",
            ]);
            cmd_log += " -vf setparams=color_primaries=bt709:color_trc=bt709,format=rgb24";
        }
    }

    cmd_log += " ";
    cmd_log += &cache_str;
    crate::log!("resolve_render_source: ffmpeg cmd: {}", cmd_log);

    cmd.arg(&cache_str)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let output = cmd
        .output()
        .map_err(|e| napi::Error::from_reason(format!("ffmpeg normalize 启动失败: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = format!("ffmpeg normalize 失败：{} stderr={}", output.status, stderr);
        crate::log!("{}", msg);
        return Ok(ResolvedRenderSource {
            render_path: original_path.clone(),
            normalized: false,
            width: color_info.width,
            height: color_info.height,
            color_primaries: color_info.color_primaries,
            color_transfer: color_info.color_transfer,
        });
    }

    crate::log!(
        "resolve_render_source: normalized OK → {} width={} height={}",
        cache_str,
        color_info.width,
        color_info.height
    );

    Ok(ResolvedRenderSource {
        render_path: cache_str,
        normalized: true,
        width: color_info.width,
        height: color_info.height,
        color_primaries: "bt709".to_string(),
        color_transfer: "bt709".to_string(),
    })
}
