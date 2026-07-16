use super::*;
use crate::log;
use crate::media::command;

impl Compositor {
    pub(super) fn get_cached_texture(&mut self, path: &str) -> Option<u32> {
        let tex_id = self.texture_cache.get(path).copied()?;
        // 移到 cache_order 末尾（最近使用）
        if let Some(pos) = self.cache_order.iter().position(|k| k == path) {
            let key = self.cache_order.remove(pos).unwrap();
            self.cache_order.push_back(key);
        }
        Some(tex_id)
    }

    /// 仅复用分辨率足够的静态纹理；缩略图缓存不能用于更大的工作台预览。
    fn get_cached_texture_at_least(&mut self, path: &str, required_max_edge: u32) -> Option<u32> {
        let tex_id = self.get_cached_texture(path)?;
        let cached_size = self
            .textures
            .get(&tex_id)
            .map(|entry| (entry.width, entry.height));
        if cached_size
            .map(|(width, height)| cached_texture_is_sufficient(width, height, required_max_edge))
            .unwrap_or(false)
        {
            return Some(tex_id);
        }

        if let Some((width, height)) = cached_size {
            log!(
                "static texture cache upgrade path={} cached={}x{} required_max_edge={}",
                path,
                width,
                height,
                required_max_edge,
            );
        } else {
            log!("static texture cache stale path={} tex_id={}", path, tex_id,);
        }

        // release_texture 会同步清理 texture_cache 和 cache_order。
        if self.textures.contains_key(&tex_id) {
            let _ = self.release_texture(tex_id);
        } else {
            self.texture_cache.remove(path);
            self.cache_order.retain(|key| key != path);
        }
        None
    }

    /// 将静态纹理加入 LRU 缓存，超出上限时淘汰最旧的
    pub(super) fn cache_static_texture(&mut self, path: String, tex_id: u32) -> Result<(), String> {
        self.texture_cache.insert(path.clone(), tex_id);
        self.cache_order.push_back(path);
        while self.cache_order.len() > MAX_TEXTURE_CACHE {
            let oldest = self.cache_order.pop_front().unwrap();
            self.static_image_probed.remove(&oldest);
            if let Some(tid) = self.texture_cache.remove(&oldest) {
                self.release_texture(tid)?;
            }
        }
        Ok(())
    }

    fn probe_static_image(&mut self, ffprobe: &str, path: &str) -> Result<(u32, u32), String> {
        if let Some(&dims) = self.static_image_probed.get(path) {
            return Ok(dims);
        }
        let dims = probe_static_image_dimensions(ffprobe, path)?;
        self.static_image_probed.insert(path.to_string(), dims);
        Ok(dims)
    }

    /// 探测视频文件尺寸（结果缓存，避免重复 ffprobe）
    fn probe_video(&mut self, ffprobe: &str, path: &str) -> Result<(u32, u32), String> {
        if let Some(&dims) = self.video_probed.get(path) {
            return Ok(dims);
        }
        let dims = probe_video_dimensions(ffprobe, path)?;
        self.video_probed.insert(path.to_string(), dims);
        Ok(dims)
    }

    fn remove_video_decoder(&mut self, path: &str) {
        if let Some(decoder) = self.video_decoders.remove(path) {
            if let Some(texture_id) = decoder.texture_id {
                let _ = self.release_texture(texture_id);
            }
        }
    }

    pub fn clear_video_decoders(&mut self) {
        let paths: Vec<String> = self.video_decoders.keys().cloned().collect();
        for path in paths {
            self.remove_video_decoder(&path);
        }
        self.video_decoding_ended.clear();
    }

    /// 获取视频帧：保持 ffmpeg pipe 存活，逐帧顺序读取。
    /// 初次 spawn + `-ss {time}` 定位起始位置，之后每次只读 pipe 的下一帧。
    /// 重新 spawn 只在预览模式（no_video_decoder_restart=false）下因 seek 或 pipe 异常时发生。
    /// 导出模式（no_video_decoder_restart=true）：EOF / 解码失败 → 标记结束，返回 Ok(None)，永不重启。
    ///
    /// 返回 Ok(Some(rgba, w, h)) = 正常帧,
    ///       Ok(None)            = 该视频层已结束（EOF / 解码失败 / seek 越界）,
    ///       Err(msg)            = 致命错误（ffmpeg 未找到等）。
    fn read_video_frame(
        &mut self,
        ffmpeg: &str,
        ffprobe: &str,
        file_path: &str,
        video_time: f64,
        fps: Option<f64>,
    ) -> Result<Option<(Vec<u8>, u32, u32)>, String> {
        // ── 已标记结束的视频 → 直接跳过 ──
        if self.video_decoding_ended.contains(file_path) {
            return Ok(None);
        }

        // ── 已有 decoder → 从 pipe 顺序读下一帧 ──
        if let Some(dec) = self.video_decoders.get_mut(file_path) {
            // 该 decoder 已标记结束
            if dec.decoding_finished {
                return Ok(None);
            }

            // 检测 seek 跳转：只在 non-export 模式下重启
            if video_time + 0.1 < dec.current_time || (video_time - dec.current_time).abs() > 2.0 {
                if self.no_video_decoder_restart {
                    log!(
                        "read_video_frame [{}] seek jump {:.3} -> {:.3}, finishing decoder",
                        file_path,
                        dec.current_time,
                        video_time,
                    );
                    dec.decoding_finished = true;
                    self.video_decoding_ended.insert(file_path.to_string());
                    return Ok(None);
                } else {
                    log!(
                        "read_video_frame [{}] seek jump {:.3} -> {:.3}, restarting",
                        file_path,
                        dec.current_time,
                        video_time,
                    );
                    self.remove_video_decoder(file_path);
                    return self.read_video_frame(ffmpeg, ffprobe, file_path, video_time, fps);
                }
            }

            // 正常读取下一帧
            let mut rgba = vec![0u8; dec.frame_bytes];
            if dec.stdout.read_exact(&mut rgba).is_err() {
                if self.no_video_decoder_restart {
                    log!(
                        "read_video_frame [{}] pipe EOF, finishing decoder",
                        file_path
                    );
                    dec.decoding_finished = true;
                    self.video_decoding_ended.insert(file_path.to_string());
                    return Ok(None);
                } else {
                    log!("read_video_frame [{}] pipe EOF, restarting", file_path);
                    self.remove_video_decoder(file_path);
                    return self.read_video_frame(ffmpeg, ffprobe, file_path, video_time, fps);
                }
            }
            dec.current_time = video_time;
            return Ok(Some((rgba, dec.scaled_w, dec.scaled_h)));
        }

        // ── 首次或换文件：spawn 持久 pipe ──
        let (vw, vh) = self.probe_video(ffprobe, file_path)?;
        let max_edge = vw.max(vh);
        let (dw, dh) = if max_edge > PREVIEW_MAX_SIZE {
            let s = PREVIEW_MAX_SIZE as f64 / max_edge as f64;
            (
                (vw as f64 * s).round().max(1.0) as u32,
                (vh as f64 * s).round().max(1.0) as u32,
            )
        } else {
            (vw, vh)
        };
        let frame_bytes = (dw * dh * 4) as usize;

        // 组装 ffmpeg 参数
        let mut args = vec![
            "-ss".to_string(),
            format!("{:.3}", video_time),
            "-i".to_string(),
            normalize_local_path(file_path),
            "-vf".to_string(),
            format!("scale={}:{}:flags=lanczos", dw, dh),
        ];
        // 导出模式下指定 -r 确保解码 fps 与导出 fps 一致
        if let Some(export_fps) = fps {
            args.extend(["-r".to_string(), export_fps.to_string()]);
        }
        args.extend([
            "-pix_fmt".to_string(),
            "rgba".to_string(),
            "-f".to_string(),
            "rawvideo".to_string(),
            "-loglevel".to_string(),
            "error".to_string(),
            "pipe:1".to_string(),
        ]);

        let mut proc = command(ffmpeg)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("ffmpeg spawn {}: {}", file_path, e))?;

        let stdout = proc.stdout.take().ok_or_else(|| "no stdout".to_string())?;
        let stderr_buf = proc.stderr.take();

        // 读第1帧
        let mut rgba = vec![0u8; frame_bytes];
        let mut child_stdout = stdout;
        if let Err(e) = child_stdout.read_exact(&mut rgba) {
            let stderr_msg = stderr_buf
                .and_then(|mut s| {
                    let mut buf = String::new();
                    s.read_to_string(&mut buf).ok().map(|_| buf)
                })
                .unwrap_or_default();
            log!(
                "read_first_frame FAIL [{}] time={:.3} expected={}x{} frame_bytes={} stderr=[{}]",
                file_path,
                video_time,
                dw,
                dh,
                frame_bytes,
                stderr_msg
            );
            if self.no_video_decoder_restart {
                // 导出模式：首次解码失败 → 标记结束，不中断导出
                self.video_decoding_ended.insert(file_path.to_string());
                return Ok(None);
            } else {
                return Err(format!(
                    "read first frame {}: {}  stderr={}",
                    file_path, e, stderr_msg
                ));
            }
        }

        self.video_decoders.insert(
            file_path.to_string(),
            VideoDecoder {
                process: proc,
                stdout: child_stdout,
                scaled_w: dw,
                scaled_h: dh,
                frame_bytes,
                current_time: video_time,
                texture_id: None,
                decoding_finished: false,
            },
        );

        log!(
            "read_video_frame [{}] started at {:.3}s {}x{}",
            file_path,
            video_time,
            dw,
            dh,
        );
        Ok(Some((rgba, dw, dh)))
    }

    /// 获取或更新视频层纹理。返回：
    ///   Ok(Some(texture_id)) = 正常帧
    ///   Ok(None)             = 视频层已结束（跳过该层）
    ///   Err(msg)             = 致命错误
    fn video_texture_for_layer(
        &mut self,
        ffmpeg: &str,
        ffprobe: &str,
        layer: &PreviewLayerInput,
        _decode_max_side: u32,
        fps: Option<f64>,
    ) -> Result<Option<u32>, String> {
        // ── 有 pipe 解码器：直接读下一帧（顺序读取最可靠） ──
        if let Some((texture_id, current_time)) = self
            .video_decoders
            .get(&layer.file_path)
            .and_then(|decoder| {
                decoder
                    .texture_id
                    .map(|texture_id| (texture_id, decoder.current_time))
            })
        {
            if (layer.video_time - current_time).abs() < 0.001 {
                log!(
                    "read_video_frame [{}] reuse paused frame at {:.3}s tex={}",
                    layer.file_path,
                    current_time,
                    texture_id,
                );
                return Ok(Some(texture_id));
            }
            match self.read_video_frame(ffmpeg, ffprobe, &layer.file_path, layer.video_time, fps)? {
                Some((rgba, dw, dh)) => {
                    // seek 跳转时 read_video_frame 内部可能已释放旧纹理（remove_video_decoder → release_texture）
                    if self.textures.contains_key(&texture_id) {
                        self.update_texture(texture_id, &rgba)?;
                        return Ok(Some(texture_id));
                    } else {
                        let new_texture_id = self.load_texture(&rgba, dw, dh)?;
                        if let Some(decoder) = self.video_decoders.get_mut(&layer.file_path) {
                            decoder.texture_id = Some(new_texture_id);
                        }
                        return Ok(Some(new_texture_id));
                    }
                }
                None => return Ok(None), // 视频层已结束
            }
        }

        // ── 无 pipe 解码器：优先创建 pipe + 读第1帧 ──
        match self.read_video_frame(ffmpeg, ffprobe, &layer.file_path, layer.video_time, fps)? {
            Some((rgba, dw, dh)) => {
                let texture_id = self.load_texture(&rgba, dw, dh)?;
                if let Some(decoder) = self.video_decoders.get_mut(&layer.file_path) {
                    decoder.texture_id = Some(texture_id);
                }
                log!(
                    "read_video_frame [{}] pipe started at {:.3}s tex={} {}x{}",
                    layer.file_path,
                    layer.video_time,
                    texture_id,
                    dw,
                    dh,
                );
                return Ok(Some(texture_id));
            }
            None => {
                log!(
                    "read_video_frame [{}] pipe failed at {:.3}s — layer discarded",
                    layer.file_path,
                    layer.video_time,
                );
                return Ok(None);
            }
        }
    }

    /// 导出模式下（fps=Some）：EOF/解码失败标记该层结束永不重启，`-r {fps}` 确保解码帧率匹配。
    /// 预览模式下（fps=None）：保持向后兼容，seek/EOF 时重启 pipe。
    pub fn render_preview(
        &mut self,
        ffmpeg: &str,
        ffprobe: &str,
        width: Option<u32>,
        height: Option<u32>,
        max_side: Option<u32>,
        layers: &[PreviewLayerInput],
        fps: Option<f64>,
    ) -> Result<(Vec<u8>, u32, u32), String> {
        // ── 清理已不再使用的视频 decoder ──
        let active_video_paths: std::collections::HashSet<&str> = layers
            .iter()
            .filter(|l| l.is_video)
            .map(|l| l.file_path.as_str())
            .collect();
        let inactive_video_paths: Vec<String> = self
            .video_decoders
            .keys()
            .filter(|path| !active_video_paths.contains(path.as_str()))
            .cloned()
            .collect();
        for path in inactive_video_paths {
            self.remove_video_decoder(&path);
        }
        self.retain_active_mask_textures(layers)?;

        let mut source_layers = Vec::with_capacity(layers.len());
        // 解码最大边长：export 时传入了有效 max_side（如 8192），
        // preview 时 max_side 为 None 或较小的值（如 2560），fallback 到 PREVIEW_MAX_SIZE
        let decode_max_side = max_side.unwrap_or(PREVIEW_MAX_SIZE).max(1);

        for layer in layers {
            let procedural = super::is_procedural_layer_type(layer.layer_type.as_deref());
            let tex_id = if procedural {
                0
            } else if layer.is_video {
                match self.video_texture_for_layer(ffmpeg, ffprobe, layer, decode_max_side, fps)? {
                    Some(id) => id,
                    None => continue, // 视频层已结束，跳过该层
                }
            } else {
                // ── 静态图：LRU 缓存 ──
                // 缓存以路径为单位保留当前最高分辨率版本。缩略图、工作台和导出
                // 共用 Compositor，因此命中时必须校验纹理尺寸，避免放大低清纹理。
                let (source_width, source_height) =
                    self.probe_static_image(ffprobe, &layer.file_path)?;
                let layer_decode_max = calc_optimal_decode_max_edge(
                    &layer.positioning,
                    width,
                    height,
                    source_width,
                    source_height,
                    decode_max_side,
                );
                let required_max_edge = source_width.max(source_height).min(layer_decode_max);
                let cached = self.get_cached_texture_at_least(&layer.file_path, required_max_edge);
                if let Some(tid) = cached {
                    tid
                } else {
                    // 对带 positioning 的层，先探测源图尺寸，计算最优解码尺寸
                    // 用 ffmpeg Lanczos 预降采样到接近显示尺寸，减少 GPU 双线性降采样导致的锯齿
                    let (rgba, w, h) = decode_static_image_scaled(
                        ffmpeg,
                        ffprobe,
                        &layer.file_path,
                        layer_decode_max,
                    )?;
                    let tid = self.load_texture(&rgba, w, h)?;
                    self.cache_static_texture(layer.file_path.clone(), tid)?;
                    tid
                }
            };

            let (texture_width, texture_height) = self
                .textures
                .get(&tex_id)
                .map(|entry| (entry.width, entry.height))
                .ok_or_else(|| format!("texture {} not found", tex_id))?;
            let mut prepared_layer = (*layer).clone();
            if let Some(mask_path) = layer.mask_path.as_deref() {
                let mask_id = if let Some(tid) = self.mask_texture_cache.get(mask_path).copied() {
                    tid
                } else {
                    let (rgba, w, h) = match decode_static_image_scaled(
                        ffmpeg,
                        ffprobe,
                        mask_path,
                        decode_max_side,
                    ) {
                        Ok(decoded) => decoded,
                        Err(error) => {
                            log!(
                                "skip source {} because mask {} is unavailable: {}",
                                layer.file_path,
                                mask_path,
                                error
                            );
                            continue;
                        }
                    };
                    let tid = match self.load_mask_texture(&rgba, w, h) {
                        Ok(tid) => tid,
                        Err(error) => {
                            log!(
                                "skip source {} because mask {} cannot be uploaded: {}",
                                layer.file_path,
                                mask_path,
                                error
                            );
                            continue;
                        }
                    };
                    self.mask_texture_cache.insert(mask_path.to_string(), tid);
                    tid
                };
                prepared_layer.mask_texture_id = Some(mask_id);
            }
            source_layers.push((
                prepared_layer,
                PreviewTextureInfo {
                    texture_id: tex_id,
                    width: texture_width,
                    height: texture_height,
                },
            ));
        }

        // 所有视频层都已结束 → 输出空白帧
        if source_layers.is_empty() {
            let (cw, ch) = match (width, height) {
                (Some(w), Some(h)) => (w.max(1), h.max(1)),
                _ => return Err("no valid layers for preview".to_string()),
            };
            let (ow, oh) = fit_output_size(cw, ch, max_side.unwrap_or(PREVIEW_MAX_SIZE));
            log!(
                "render_preview all layers ended, output blank {}x{}",
                ow,
                oh,
            );
            return Ok((vec![0u8; (ow * oh * 4) as usize], ow, oh));
        }

        let planned = self.plan_preview(width, height, max_side, &source_layers)?;
        let (src_w, src_h) = source_layers
            .first()
            .map(|(_, ti)| (ti.width, ti.height))
            .unwrap_or((0, 0));
        let now = std::time::Instant::now();
        let should_log = match self.last_preview_log {
            Some((last_src_w, last_src_h, last_out_w, last_out_h, last_at)) => {
                last_src_w != src_w
                    || last_src_h != src_h
                    || last_out_w != planned.width
                    || last_out_h != planned.height
                    || now.duration_since(last_at).as_millis() >= 1000
            }
            None => true,
        };
        if should_log {
            self.last_preview_log = Some((src_w, src_h, planned.width, planned.height, now));
            log!(
                "render_preview output source={}x{} requested={:?}x{:?} max_side={:?} -> {}x{} layers={}",
                src_w, src_h, width, height, max_side, planned.width, planned.height, source_layers.len()
            );
        }
        let result = self.render(planned.width, planned.height, &planned.layers)?;

        Ok((result, planned.width, planned.height))
    }
}
