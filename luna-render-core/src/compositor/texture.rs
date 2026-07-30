use super::mask::encode_mask_distance_channels;
use super::*;
use crate::media::command;
use crate::{log, log_error};

impl Compositor {
    // ── 纹理管理 ──

    pub fn load_texture(&mut self, data: &[u8], width: u32, height: u32) -> Result<u32, String> {
        if width == 0 || height == 0 {
            return Err("texture size must be greater than 0".to_string());
        }
        if width > self.max_texture_size || height > self.max_texture_size {
            let msg = format!(
                "texture size {}x{} exceeds GPU limit {}",
                width, height, self.max_texture_size
            );
            log_error!("{}", msg);
            return Err(msg);
        }
        let expected = width
            .checked_mul(height)
            .and_then(|v| v.checked_mul(4))
            .ok_or_else(|| format!("texture size overflow: {}x{}", width, height))?
            as usize;
        if data.len() < expected {
            log_error!("load_texture data too small: {} < {}", data.len(), expected);
            return Err(format!("data too small: {} < {}", data.len(), expected));
        }

        let id = self.next_texture_id;
        self.next_texture_id += 1;
        log!(
            "load_texture id={} size={}x{} data={}bytes",
            id,
            width,
            height,
            expected
        );

        // 单 level + bilinear，Lanczos 预缩到接近渲染尺寸
        // sRGB 格式：GPU 自动做 sRGB→linear 转换，使双线性插值和色彩混合在正确的色彩空间进行
        let texture = create_rgba_texture(
            &self.device,
            "layer",
            width,
            height,
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            1,
            true,
        );
        upload_rgba(&self.queue, &texture, &data[..expected], width, height);

        self.textures.insert(
            id,
            TextureEntry {
                texture,
                width,
                height,
                #[cfg(target_os = "windows")]
                external: false,
            },
        );
        Ok(id)
    }

    pub(super) fn load_mask_texture(
        &mut self,
        data: &[u8],
        width: u32,
        height: u32,
    ) -> Result<u32, String> {
        let expected = width
            .checked_mul(height)
            .and_then(|value| value.checked_mul(4))
            .ok_or_else(|| format!("mask texture size overflow: {}x{}", width, height))?
            as usize;
        if width == 0 || height == 0 || data.len() < expected {
            return Err(format!(
                "invalid mask texture data for {}x{}",
                width, height
            ));
        }
        let id = self.next_texture_id;
        self.next_texture_id += 1;
        let texture = create_rgba_texture(
            &self.device,
            "color-mask",
            width,
            height,
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            1,
            false,
        );
        let distance_encoded = encode_mask_distance_channels(&data[..expected], width, height);
        upload_rgba(&self.queue, &texture, &distance_encoded, width, height);
        self.textures.insert(
            id,
            TextureEntry {
                texture,
                width,
                height,
                #[cfg(target_os = "windows")]
                external: false,
            },
        );
        Ok(id)
    }

    pub fn load_texture_from_path(
        &mut self,
        ffmpeg: &str,
        ffprobe: &str,
        path: &str,
        max_size: u32,
    ) -> Result<(u32, u32, u32), String> {
        let max_size = max_size.max(1).min(self.max_texture_size);

        // ── LRU 缓存命中 → 验证纹理仍存在，直接返回 ──
        if let Some(tex_id) = self.get_cached_texture(path) {
            if let Some(entry) = self.textures.get(&tex_id) {
                log!(
                    "load_texture_from_path [CACHE HIT] {} tex_id={} {}x{}",
                    path,
                    tex_id,
                    entry.width,
                    entry.height
                );
                return Ok((tex_id, entry.width, entry.height));
            } else {
                log!(
                    "load_texture_from_path [CACHE MISS:texture_gone] {} tex_id={}",
                    path,
                    tex_id
                );
            }
        } else {
            log!("load_texture_from_path [CACHE MISS] {}", path);
        }

        // ── ffprobe 获取原始尺寸 + EXIF 旋转 ──
        let probe_output = command(ffprobe)
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
            .map_err(|e| format!("ffprobe {}: {}", path, e))?;
        let probe_stdout = String::from_utf8_lossy(&probe_output.stdout);
        let parsed: serde_json::Value =
            serde_json::from_str(&probe_stdout).map_err(|e| format!("ffprobe json: {}", e))?;
        log!("load_texture_from_path ffprobe stdout={}", probe_stdout);
        // 从 frames[0] 取宽高
        let frames = parsed["frames"]
            .as_array()
            .ok_or_else(|| format!("ffprobe: no frames in {}", path))?;
        let frame = frames
            .iter()
            .find(|f| f["media_type"].as_str() == Some("video"))
            .ok_or_else(|| format!("ffprobe: no video frame in {}", path))?;
        let source_w = frame["width"].as_u64().unwrap_or(0) as u32;
        let source_h = frame["height"].as_u64().unwrap_or(0) as u32;
        if source_w == 0 || source_h == 0 {
            return Err(format!("ffprobe: invalid image size in {}", path));
        }
        // ── 从 side_data_list.displaymatrix.rotation 提取旋转角度 ──
        let displaymatrix_rotation = frame["side_data_list"]
            .as_array()
            .and_then(|list| {
                list.iter()
                    .filter_map(|sd| sd["rotation"].as_f64())
                    .map(|r| r as i32)
                    .find(|&r| r == 90 || r == 270)
            })
            .unwrap_or(0);
        // ── 从 EXIF tags.Orientation 提取（值 6=90°CW, 8=270°CW/90°CCW）──
        let exif_orientation = frame["tags"]["Orientation"]
            .as_str()
            .and_then(|s| s.trim().parse::<i32>().ok())
            .unwrap_or(0);
        let exif_rotate = match exif_orientation {
            6 => 90,  // Rotate 90° CW
            8 => 270, // Rotate 270° CW (90° CCW)
            _ => 0,
        };
        let rotate_raw = frame["side_data_list"]
            .as_array()
            .map(|list| {
                let vals: Vec<String> = list
                    .iter()
                    .map(|sd| {
                        format!(
                            "{} r={}",
                            sd["side_data_type"].as_str().unwrap_or("?"),
                            sd["rotation"]
                        )
                    })
                    .collect();
                vals.join(" | ")
            })
            .unwrap_or_default();
        let rotate = if displaymatrix_rotation != 0 {
            displaymatrix_rotation
        } else {
            exif_rotate
        };
        log!(
            "load_texture_from_path side_data=[{}] orientation={} rotate={}",
            rotate_raw,
            exif_orientation,
            rotate
        );
        let (source_w, source_h) = if rotate == 90 || rotate == 270 {
            log!(
                "load_texture_from_path SWAP {}x{} -> {}x{}",
                source_w,
                source_h,
                source_h,
                source_w
            );
            (source_h, source_w)
        } else {
            (source_w, source_h)
        };

        // ── HDR / 宽色域 自动 normalize → SDR sRGB ──
        fn contains_any(s: &str, keys: &[&str]) -> bool {
            let lower = s.to_lowercase();
            keys.iter().any(|k| lower.contains(k))
        }
        // color_primaries/transfer 在 stream 级别更可靠，frame 级别可能为空
        let stream = parsed["streams"].as_array().and_then(|ss| {
            ss.iter()
                .find(|s| s["codec_type"].as_str() == Some("video"))
        });
        let primaries = stream
            .and_then(|s| s["color_primaries"].as_str())
            .or_else(|| frame["color_primaries"].as_str())
            .unwrap_or("");
        let transfer = stream
            .and_then(|s| s["color_transfer"].as_str())
            .or_else(|| frame["color_transfer"].as_str())
            .unwrap_or("");
        let bit_depth = frame["bits_per_raw_sample"].as_u64().unwrap_or(8) as u32;
        let is_pq = contains_any(
            transfer,
            &[
                "2084",
                "smpte2084",
                "smpte st 2084",
                "pq",
                "perceptual quantizer",
            ],
        );
        let is_hlg = contains_any(transfer, &["hlg", "arib", "b67", "arib-std-b67"]);
        let is_bt2020 = contains_any(primaries, &["2020", "bt2020", "bt.2020", "rec.2020"]);
        let is_display_p3 = contains_any(primaries, &["p3", "display-p3", "display p3", "dcip3"]);
        let is_hdr_transfer = is_pq || is_hlg;
        let is_wide_gamut = is_bt2020 || is_display_p3;
        let is_high_bit_depth = bit_depth > 8;
        log!("load_texture_from_path color_info: primaries={} transfer={} bit_depth={} is_hdr={} is_wide_gamut={} is_high_bit_depth={}",
            primaries, transfer, bit_depth, is_hdr_transfer || is_wide_gamut, is_wide_gamut, is_high_bit_depth);

        let use_path = if is_hdr_transfer || is_wide_gamut {
            let cache_dir = std::env::temp_dir().join("luna-rc/color-normalized");
            let _ = std::fs::create_dir_all(&cache_dir);
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            path.hash(&mut hasher);
            let hash = hasher.finish();
            let cache_path = cache_dir.join(format!("{:016x}_sdr_srgb.png", hash));
            let cache_str = cache_path.to_string_lossy().to_string();
            if !cache_path.exists() {
                log!(
                    "load_texture_from_path: normalizing {} → {}",
                    path,
                    cache_str
                );
                let zscale_avail = command(ffmpeg)
                    .args(["-filters"])
                    .stderr(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::null())
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stderr).contains("zscale"))
                    .unwrap_or(false);
                let mut norm = command(ffmpeg);
                norm.args(["-y", "-i", path]);
                if is_hdr_transfer && zscale_avail {
                    norm.args(["-vf", "zscale=transfer=linear,tonemap=hable,zscale=transfer=bt709:p=bt709:m=bt709,format=rgb24"]);
                } else if zscale_avail {
                    norm.args(["-vf", "zscale=p=bt709:t=bt709:m=bt709,format=rgb24"]);
                } else {
                    norm.args([
                        "-vf",
                        "setparams=color_primaries=bt709:color_trc=bt709,format=rgb24",
                    ]);
                }
                norm.args([&cache_str])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::piped());
                let norm_out = norm.output().map_err(|e| format!("normalize: {}", e))?;
                if !norm_out.status.success() {
                    let stderr = String::from_utf8_lossy(&norm_out.stderr);
                    log!(
                        "load_texture_from_path: normalize FAILED, using original: {}",
                        stderr
                    );
                    path.to_string()
                } else {
                    log!("load_texture_from_path: normalize OK → {}", cache_str);
                    cache_str
                }
            } else {
                log!("load_texture_from_path: normalize cache HIT: {}", cache_str);
                cache_str
            }
        } else {
            path.to_string()
        };

        // ── 计算缩放后尺寸 ──
        let (width, height) = {
            let max_edge = source_w.max(source_h);
            if max_edge > max_size {
                let scale = max_size as f64 / max_edge as f64;
                (
                    (source_w as f64 * scale).round().max(1.0) as u32,
                    (source_h as f64 * scale).round().max(1.0) as u32,
                )
            } else {
                (source_w, source_h)
            }
        };

        // ── ffmpeg 解码 + resize → rawvideo ──
        let mut proc = command(ffmpeg)
            .args([
                "-i",
                &use_path,
                "-vf",
                &format!("scale={}:{}:flags=lanczos", width, height),
                "-pix_fmt",
                "rgba",
                "-f",
                "rawvideo",
                "-vframes",
                "1",
                "-loglevel",
                "error",
                "pipe:1",
            ])
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|e| format!("ffmpeg spawn {}: {}", path, e))?;

        let mut rgba = vec![];
        proc.stdout
            .take()
            .ok_or_else(|| "ffmpeg: no stdout".to_string())?
            .read_to_end(&mut rgba)
            .map_err(|e| format!("ffmpeg read {}: {}", use_path, e))?;
        let status = proc
            .wait()
            .map_err(|e| format!("ffmpeg wait {}: {}", path, e))?;
        if !status.success() {
            return Err(format!("ffmpeg exit {} for {}", status, use_path));
        }

        log!(
            "load_texture_from_path ffmpeg path={} source={}x{} texture={}x{} rgba={}bytes",
            path,
            source_w,
            source_h,
            width,
            height,
            rgba.len(),
        );
        let id = self.load_texture(&rgba, width, height)?;
        self.cache_static_texture(path.to_string(), id)?;
        log!(
            "load_texture_from_path RETURN id={} {}x{}",
            id,
            width,
            height
        );
        Ok((id, width, height))
    }

    pub fn update_texture(&mut self, texture_id: u32, data: &[u8]) -> Result<(), String> {
        let entry = self
            .textures
            .get(&texture_id)
            .ok_or_else(|| format!("texture {} not found", texture_id))?;
        let expected = (entry.width * entry.height * 4) as usize;
        if data.len() < expected {
            log_error!(
                "update_texture data too small: {} < {}",
                data.len(),
                expected
            );
            return Err(format!("data too small: {} < {}", data.len(), expected));
        }
        upload_rgba(
            &self.queue,
            &entry.texture,
            &data[..expected],
            entry.width,
            entry.height,
        );
        Ok(())
    }
}
