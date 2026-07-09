//! PreviewEngine — 后台预览引擎
//!
//! 用状态驱动的后台线程替代同步 `renderCompositionFrame`。
//! ffmpeg-next 解码在后台线程进行（不阻塞 compositor 锁），
//! 解码后的帧上传 GPU 后走现有 `Compositor::render_preview()` 合成。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use crate::compositor::DecodedVideoFrameData;
use crate::lock_preview;

// ── napi 导出类型（⚠️ u64 不能用，napi-js 是 f64） ──

#[napi(object)]
pub struct PreviewEngineConfig {
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    /// 拖动模式最大边长（默认 720）
    pub drag_max_side: Option<u32>,
    /// 播放模式最大边长（默认 1280）
    pub play_max_side: Option<u32>,
    /// 停止拖动画质模式最大边长（默认 1920）
    pub final_max_side: Option<u32>,
}

#[napi(object)]
pub struct PreviewUpdateInput {
    pub request_id: f64,
    /// "idle" | "playing" | "dragging" | "final-seek"
    pub mode: String,
    pub time: f64,
    pub composition: crate::composition::CompositionInput,
}

#[napi(object)]
pub struct PreviewFrameOutput {
    pub frame_id: f64,
    pub request_id: f64,
    pub data: Buffer,
    pub width: u32,
    pub height: u32,
}

// ── 内部类型 ──

#[derive(Clone, Copy, PartialEq, Debug)]
enum PreviewMode {
    Idle,
    Playing,
    Dragging,
    FinalSeek,
}

fn parse_mode(s: &str) -> PreviewMode {
    match s {
        "playing" => PreviewMode::Playing,
        "dragging" => PreviewMode::Dragging,
        "final-seek" | "finalSeek" => PreviewMode::FinalSeek,
        _ => PreviewMode::Idle,
    }
}

/// 线程安全内部帧（不使用 napi Buffer，保证 Send+Sync）
#[derive(Clone)]
struct InternalPreviewFrame {
    frame_id: f64,
    request_id: f64,
    data: Vec<u8>,
    width: u32,
    height: u32,
}

/// 转换为 napi 导出类型
impl InternalPreviewFrame {
    fn into_output(self) -> PreviewFrameOutput {
        PreviewFrameOutput {
            frame_id: self.frame_id,
            request_id: self.request_id,
            data: self.data.into(),
            width: self.width,
            height: self.height,
        }
    }
}

#[derive(Clone)]
struct PreviewSnapshot {
    request_id: f64,
    mode: PreviewMode,
    time: f64,
    composition: crate::composition::CompositionInput,
}

// ── ffmpeg-next VideoDecoder ──

struct VideoDecoder {
    ictx: ffmpeg_next::format::context::Input,
    stream_index: usize,
    decoder: ffmpeg_next::codec::decoder::video::Video,
    scaler: ffmpeg_next::software::scaling::context::Context,
    scaled_w: u32,
    scaled_h: u32,
    current_pts: i64,
    time_base: f64,
}

impl VideoDecoder {
    fn open(path: &str, max_side: u32) -> Result<Self, String> {
        let ictx = ffmpeg_next::format::input(path)
            .map_err(|e| format!("ffmpeg open {}: {}", path, e))?;

        let input_stream = ictx
            .streams()
            .best(ffmpeg_next::media::Type::Video)
            .ok_or_else(|| format!("no video stream in {}", path))?;
        let stream_index = input_stream.index();
        let tb = input_stream.time_base();

        // ffmpeg-next 8.x：使用 parameters() 替代已删除的 codec()
        let codecpar = input_stream.parameters();
        let codec_ctx = ffmpeg_next::codec::context::Context::from_parameters(codecpar)
            .map_err(|e| format!("ffmpeg codec context {}: {}", path, e))?;
        let decoder_ctx = codec_ctx.decoder().video()
            .map_err(|e| format!("ffmpeg video decoder {}: {}", path, e))?;

        let (src_w, src_h) = (decoder_ctx.width(), decoder_ctx.height());
        let max_edge = src_w.max(src_h);
        let (dst_w, dst_h) = if max_edge > max_side {
            let s = max_side as f64 / max_edge as f64;
            ((src_w as f64 * s).round().max(1.0) as u32, (src_h as f64 * s).round().max(1.0) as u32)
        } else {
            (src_w, src_h)
        };

        let scaler = ffmpeg_next::software::scaling::context::Context::get(
            decoder_ctx.format(),
            src_w,
            src_h,
            ffmpeg_next::format::Pixel::RGBA,
            dst_w,
            dst_h,
            ffmpeg_next::software::scaling::flag::Flags::BILINEAR,
        )
        .map_err(|e| format!("ffmpeg scaler {}: {}", path, e))?;

        let time_base = tb.numerator() as f64 / tb.denominator() as f64;

        crate::compositor::log_write(&format!(
            "[PreviewEngine] VideoDecoder::open {} {}x{} -> {}x{} tb={}",
            path, src_w, src_h, dst_w, dst_h, time_base
        ));

        Ok(Self {
            ictx,
            stream_index,
            decoder: decoder_ctx,
            scaler,
            scaled_w: dst_w,
            scaled_h: dst_h,
            current_pts: -1,
            time_base,
        })
    }

    /// 在 `time` 处 seek 并解码一帧
    fn seek_and_decode(&mut self, time: f64) -> Result<DecodedVideoFrameData, String> {
        let pts = (time / self.time_base).max(0.0) as i64;
        let seek_pts = pts.max(0);
        self.ictx
            .seek(seek_pts, ..(seek_pts + 1))
            .map_err(|e| format!("seek @{:.3} -> {}: {}", time, seek_pts, e))?;
        self.decoder.flush();
        self.current_pts = seek_pts;

        let result = self.decode_one_frame();
        crate::compositor::log_write(&format!(
            "[PreviewEngine] seek_and_decode @{:.3} pts={} {}",
            time,
            seek_pts,
            if result.is_ok() { "OK" } else { "FAIL" }
        ));
        result
    }

    /// 从当前位置解码下一帧（不 seek）
    fn decode_next_frame(&mut self) -> Result<DecodedVideoFrameData, String> {
        self.decode_one_frame()
    }

    /// 内部：读 packet → 解帧 → 缩放到 RGBA
    fn decode_one_frame(&mut self) -> Result<DecodedVideoFrameData, String> {
        // 先尝试从 decoder 缓存的帧中取（可能上次 send_packet 攒了多帧）
        let mut decoded = ffmpeg_next::util::frame::Video::empty();
        if self.decoder.receive_frame(&mut decoded).is_ok() {
            return self.scale_frame(&decoded);
        }

        // 循环读 packet，直到解出一帧
        for (stream, packet) in self.ictx.packets() {
            if stream.index() != self.stream_index {
                continue;
            }
            self.decoder
                .send_packet(&packet)
                .map_err(|e| format!("send_packet: {:?}", e))?;

            let mut decoded = ffmpeg_next::util::frame::Video::empty();
            if self.decoder.receive_frame(&mut decoded).is_ok() {
                return self.scale_frame(&decoded);
            }
        }

        // 文件读完 → send_eof 尝试取最后的帧
        self.decoder.send_eof().ok();
        let mut decoded = ffmpeg_next::util::frame::Video::empty();
        if self.decoder.receive_frame(&mut decoded).is_ok() {
            return self.scale_frame(&decoded);
        }

        Err("end of stream".to_string())
    }

    fn scale_frame(
        &mut self,
        frame: &ffmpeg_next::util::frame::Video,
    ) -> Result<DecodedVideoFrameData, String> {
        let mut rgb = ffmpeg_next::util::frame::Video::empty();
        self.scaler
            .run(frame, &mut rgb)
            .map_err(|e| format!("scale: {:?}", e))?;
        let data = rgb.data(0).to_vec();
        Ok(DecodedVideoFrameData {
            data,
            width: self.scaled_w,
            height: self.scaled_h,
        })
    }
}

// ── 引擎配置 ──

struct EngineConfig {
    ffmpeg_path: String,
    ffprobe_path: String,
    drag_max_side: u32,
    play_max_side: u32,
    final_max_side: u32,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            ffmpeg_path: String::new(),
            ffprobe_path: String::new(),
            drag_max_side: 720,
            play_max_side: 1280,
            final_max_side: 1920,
        }
    }
}

// ── PreviewEngine ──

pub struct PreviewEngine {
    engine_id: String,
    state: Arc<RwLock<Option<PreviewSnapshot>>>,
    latest_frame: Arc<RwLock<Option<InternalPreviewFrame>>>,
    wake_tx: mpsc::Sender<()>,
    worker_handle: Option<JoinHandle<()>>,
    shutdown_tx: Option<mpsc::Sender<()>>,
    next_frame_id: Arc<AtomicU64>,
    config: EngineConfig,
}

impl PreviewEngine {
    pub fn new(engine_id: String, config: PreviewEngineConfig) -> Self {
        let state: Arc<RwLock<Option<PreviewSnapshot>>> = Arc::new(RwLock::new(None));
        let latest_frame: Arc<RwLock<Option<InternalPreviewFrame>>> = Arc::new(RwLock::new(None));
        let next_frame_id = Arc::new(AtomicU64::new(0));

        let (wake_tx, wake_rx) = mpsc::channel::<()>();
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();

        let engine_cfg = EngineConfig {
            ffmpeg_path: config.ffmpeg_path,
            ffprobe_path: config.ffprobe_path,
            drag_max_side: config.drag_max_side.unwrap_or(720),
            play_max_side: config.play_max_side.unwrap_or(1280),
            final_max_side: config.final_max_side.unwrap_or(1920),
        };

        let worker_state = Arc::clone(&state);
        let worker_frame = Arc::clone(&latest_frame);
        let worker_wake = wake_rx;
        let worker_shutdown = shutdown_rx;
        let worker_frame_id = Arc::clone(&next_frame_id);
        let worker_cfg = EngineConfig {
            ffmpeg_path: engine_cfg.ffmpeg_path.clone(),
            ffprobe_path: engine_cfg.ffprobe_path.clone(),
            ..engine_cfg
        };

        let handle = thread::Builder::new()
            .name(format!("preview-engine-{}", engine_id))
            .spawn(move || {
                Self::worker_loop(
                    worker_state,
                    worker_frame,
                    worker_wake,
                    worker_shutdown,
                    worker_frame_id,
                    worker_cfg,
                );
            })
            .expect("failed to spawn PreviewEngine worker thread");

        Self {
            engine_id,
            state,
            latest_frame,
            wake_tx,
            worker_handle: Some(handle),
            shutdown_tx: Some(shutdown_tx),
            next_frame_id,
            config: engine_cfg,
        }
    }

    /// 更新引擎状态（立即返回，不阻塞）
    pub fn update_state(&self, input: PreviewUpdateInput) {
        let snapshot = PreviewSnapshot {
            request_id: input.request_id,
            mode: parse_mode(&input.mode),
            time: input.time,
            composition: input.composition,
        };

        if let Ok(mut guard) = self.state.write() {
            *guard = Some(snapshot);
        }
        // 唤醒 worker
        let _ = self.wake_tx.send(());
    }

    /// 获取最新帧（无阻塞）
    pub fn get_latest_frame(&self) -> Option<PreviewFrameOutput> {
        self.latest_frame
            .read()
            .ok()
            .and_then(|guard| guard.as_ref().map(|f| f.clone().into_output()))
    }

    /// 停止 worker 线程
    pub fn shutdown(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.worker_handle.take() {
            let _ = handle.join();
        }
    }

    // ── Worker 循环 ──

    fn worker_loop(
        state: Arc<RwLock<Option<PreviewSnapshot>>>,
        latest_frame: Arc<RwLock<Option<InternalPreviewFrame>>>,
        wake_rx: mpsc::Receiver<()>,
        shutdown_rx: mpsc::Receiver<()>,
        next_frame_id: Arc<AtomicU64>,
        config: EngineConfig,
    ) {
        // ffmpeg 全局注册，在首次使用时自动完成
        // （ffmpeg_sys_next 通过全局构造函数注册所有 codec）

        // 各视频文件的 decoder 缓存 <file_path → VideoDecoder>
        let mut decoders: HashMap<String, VideoDecoder> = HashMap::new();

        loop {
            // ── 等待唤醒信号 ──
            // 使用 select 风格：检查 shutdown 和 wake
            let woken = {
                // 先取一个 wake 信号（阻塞）
                let has_wake = wake_rx.recv().is_ok();
                if !has_wake {
                    // wake_rx 已关闭 → 退出
                    break;
                }
                // 尽量清空 wake 队列（防止积压）
                while let Ok(()) = wake_rx.try_recv() {}
                has_wake
            };

            if !woken {
                continue;
            }

            // 检查是否收到关闭信号
            if shutdown_rx.try_recv().is_ok() {
                break;
            }

            // ── 读状态快照 ──
            let snapshot = match state.read().ok().and_then(|g| g.clone()) {
                Some(s) => s,
                None => continue,
            };

            if snapshot.mode == PreviewMode::Idle {
                continue;
            }

            let max_side = match snapshot.mode {
                PreviewMode::Dragging => config.drag_max_side,
                PreviewMode::Playing => config.play_max_side,
                PreviewMode::FinalSeek | PreviewMode::Idle => config.final_max_side,
            };

            // ── 构建当前帧的 PreviewLayerInput ──
            let layers = crate::composition::composition_layers(
                &snapshot.composition,
                snapshot.time,
            );

            // ── 解码所有视频层（🔑 关键：在 compositor 锁外） ──
            let mut decoded_frames: HashMap<String, DecodedVideoFrameData> = HashMap::new();

            for layer in &layers {
                if !layer.is_video {
                    continue;
                }
                let path = &layer.file_path;

                // 已有 decoder → seek 到目标时间
                let has_decoder = decoders.contains_key(path);

                let frame = if has_decoder {
                    let dec = decoders.get_mut(path).unwrap();

                    if snapshot.mode == PreviewMode::Playing {
                        // 播放模式：顺序读下一帧
                        match dec.decode_next_frame() {
                            Ok(f) => f,
                            Err(_) => {
                                // 读完了尝试重新 seek 到开始
                                crate::compositor::log_write(
                                    &format!("[PreviewEngine] {} EOF, restarting", path),
                                );
                                match VideoDecoder::open(path, max_side) {
                                    Ok(new_dec) => {
                                        decoders.insert(path.clone(), new_dec);
                                        let dec = decoders.get_mut(path).unwrap();
                                        match dec.seek_and_decode(snapshot.time) {
                                            Ok(f) => f,
                                            Err(e) => {
                                                crate::compositor::log_write(&format!(
                                                    "[PreviewEngine] {} restart failed: {}",
                                                    path, e
                                                ));
                                                continue;
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        crate::compositor::log_write(&format!(
                                            "[PreviewEngine] {} reopen failed: {}",
                                            path, e
                                        ));
                                        continue;
                                    }
                                }
                            }
                        }
                    } else {
                        // 拖动/跳转模式：seek
                        match dec.seek_and_decode(snapshot.time) {
                            Ok(f) => f,
                            Err(e) => {
                                crate::compositor::log_write(&format!(
                                    "[PreviewEngine] {} seek failed @{:.3}: {}",
                                    path, snapshot.time, e
                                ));
                                continue;
                            }
                        }
                    }
                } else {
                    // 首次打开此文件
                    match VideoDecoder::open(path, max_side) {
                        Ok(mut dec) => {
                            let result = if snapshot.mode == PreviewMode::Playing {
                                dec.seek_and_decode(snapshot.time)
                            } else {
                                dec.seek_and_decode(snapshot.time)
                            };
                            match result {
                                Ok(f) => {
                                    decoders.insert(path.clone(), dec);
                                    f
                                }
                                Err(e) => {
                                    crate::compositor::log_write(&format!(
                                        "[PreviewEngine] {} first decode failed @{:.3}: {}",
                                        path, snapshot.time, e
                                    ));
                                    continue;
                                }
                            }
                        }
                        Err(e) => {
                            crate::compositor::log_write(&format!(
                                "[PreviewEngine] {} open failed: {}",
                                path, e
                            ));
                            continue;
                        }
                    }
                };

                decoded_frames.insert(path.clone(), frame);
            }

            // ── 释放不再使用的 decoder ──
            let active_paths: std::collections::HashSet<&str> =
                layers.iter().filter(|l| l.is_video).map(|l| l.file_path.as_str()).collect();
            let stale: Vec<String> = decoders
                .keys()
                .filter(|p| !active_paths.contains(p.as_str()))
                .cloned()
                .collect();
            for path in stale {
                decoders.remove(&path);
            }

            // ── 合成（进入 compositor 锁） ──
            let frame_id = next_frame_id.fetch_add(1, Ordering::SeqCst);

            let result = lock_preview(|c| {
                // 用预解码帧渲染
                let (data, out_w, out_h) = c.render_preview(
                    &config.ffmpeg_path,
                    &config.ffprobe_path,
                    Some(snapshot.composition.canvas.width),
                    Some(snapshot.composition.canvas.height),
                    Some(max_side),
                    &layers,
                    Some(&decoded_frames),
                )?;
                Ok(InternalPreviewFrame {
                    frame_id: frame_id as f64,
                    request_id: snapshot.request_id,
                    data,
                    width: out_w,
                    height: out_h,
                })
            });

            let output = match result {
                Ok(frame) => frame,
                Err(e) => {
                    crate::compositor::log_write(&format!(
                        "[PreviewEngine] render failed id={}: {}",
                        frame_id, e
                    ));
                    continue;
                }
            };

            // ── 写入 latest_frame ──
            if let Ok(mut guard) = latest_frame.write() {
                *guard = Some(output);
            }
        }

        crate::compositor::log_write("[PreviewEngine] worker exited");
    }
}

// ── 全局引擎注册表 ──

static ENGINES: std::sync::LazyLock<Mutex<HashMap<String, PreviewEngine>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

// ── napi 导出 ──

#[napi]
pub fn create_preview_engine(
    engine_id: String,
    config: PreviewEngineConfig,
) -> napi::Result<()> {
    let engine = PreviewEngine::new(engine_id.clone(), config);
    if let Ok(mut map) = ENGINES.lock() {
        map.insert(engine_id, engine);
    }
    Ok(())
}

#[napi]
pub fn update_preview_state(engine_id: String, input: PreviewUpdateInput) -> napi::Result<()> {
    if let Ok(map) = ENGINES.lock() {
        if let Some(engine) = map.get(&engine_id) {
            engine.update_state(input);
            return Ok(());
        }
    }
    Err(napi::Error::from_reason(format!(
        "PreviewEngine {} not found",
        engine_id
    )))
}

#[napi]
pub fn get_latest_preview_frame(
    engine_id: String,
) -> napi::Result<Option<PreviewFrameOutput>> {
    if let Ok(map) = ENGINES.lock() {
        if let Some(engine) = map.get(&engine_id) {
            return Ok(engine.get_latest_frame());
        }
    }
    Ok(None)
}

#[napi]
pub fn destroy_preview_engine(engine_id: String) -> napi::Result<()> {
    if let Ok(mut map) = ENGINES.lock() {
        if let Some(mut engine) = map.remove(&engine_id) {
            engine.shutdown();
        }
    }
    Ok(())
}

/// 清理所有预览引擎
#[napi]
pub fn destroy_all_preview_engines() -> napi::Result<()> {
    if let Ok(mut map) = ENGINES.lock() {
        for (_, mut engine) in map.drain() {
            engine.shutdown();
        }
    }
    Ok(())
}
