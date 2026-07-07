use ffmpeg_next as ffmpeg;
use ffmpeg::format::Pixel;
use ffmpeg::media::Type;
use ffmpeg::software::scaling::{context::Context as ScaleContext, flag::Flags};
use ffmpeg::util::frame::video::Video;
use std::sync::{mpsc, Arc, Mutex, Once};
use std::thread;

const AV_TIME_BASE: f64 = 1_000_000.0;

static FFMPEG_INIT: Once = Once::new();

#[derive(Clone)]
pub struct DecodedVideoFrame {
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub time: f64,
}

pub struct VideoFrameDecoder {
    ictx: ffmpeg::format::context::Input,
    decoder: ffmpeg::decoder::Video,
    scaler: ScaleContext,
    stream_index: usize,
    width: u32,
    height: u32,
    current_time: f64,
    last_frame: Option<DecodedVideoFrame>,
}

// The decoder is stored behind the compositor Mutex and is never accessed
// concurrently. FFmpeg's raw pointers are confined to that locked context.
unsafe impl Send for VideoFrameDecoder {}

pub struct AsyncVideoFrameDecoder {
    request_tx: mpsc::Sender<f64>,
    latest: Arc<Mutex<Option<DecodedVideoFrame>>>,
}

impl AsyncVideoFrameDecoder {
    pub fn start(path: String, max_side: u32) -> Self {
        let (request_tx, request_rx) = mpsc::channel::<f64>();
        let latest = Arc::new(Mutex::new(None));
        let worker_latest = Arc::clone(&latest);
        thread::spawn(move || {
            let mut decoder = match VideoFrameDecoder::open(&path, max_side) {
                Ok(decoder) => decoder,
                Err(error) => {
                    crate::log!("video_frame_worker [{}] open failed: {}", path, error);
                    return;
                }
            };
            while let Ok(mut target_time) = request_rx.recv() {
                while let Ok(next_time) = request_rx.try_recv() {
                    target_time = next_time;
                }
                match decoder.frame_at(target_time) {
                    Ok(frame) => {
                        if let Ok(mut latest) = worker_latest.lock() {
                            *latest = Some(frame);
                        }
                    }
                    Err(error) => {
                        crate::log!(
                            "video_frame_worker [{}] decode {:.3} failed: {}",
                            path,
                            target_time,
                            error
                        );
                    }
                }
            }
        });

        Self {
            request_tx,
            latest,
        }
    }

    pub fn request(&self, time: f64) {
        let _ = self.request_tx.send(time.max(0.0));
    }

    pub fn latest(&self) -> Option<DecodedVideoFrame> {
        self.latest.lock().ok().and_then(|frame| frame.clone())
    }
}

impl VideoFrameDecoder {
    pub fn open(path: &str, max_side: u32) -> Result<Self, String> {
        FFMPEG_INIT.call_once(|| {
            let _ = ffmpeg::init();
        });

        let ictx = ffmpeg::format::input(path).map_err(|e| format!("ffmpeg open {}: {}", path, e))?;
        let input = ictx
            .streams()
            .best(Type::Video)
            .ok_or_else(|| format!("no video stream: {}", path))?;
        let stream_index = input.index();
        let context = ffmpeg::codec::context::Context::from_parameters(input.parameters())
            .map_err(|e| format!("decoder parameters {}: {}", path, e))?;
        let decoder = context
            .decoder()
            .video()
            .map_err(|e| format!("video decoder {}: {}", path, e))?;

        let source_w = decoder.width().max(1);
        let source_h = decoder.height().max(1);
        let max_edge = source_w.max(source_h);
        let (width, height) = if max_edge > max_side.max(1) {
            let scale = max_side.max(1) as f64 / max_edge as f64;
            (
                (source_w as f64 * scale).round().max(1.0) as u32,
                (source_h as f64 * scale).round().max(1.0) as u32,
            )
        } else {
            (source_w, source_h)
        };

        let scaler = ScaleContext::get(
            decoder.format(),
            source_w,
            source_h,
            Pixel::RGBA,
            width,
            height,
            Flags::BILINEAR,
        )
        .map_err(|e| format!("video scaler {}: {}", path, e))?;

        Ok(Self {
            ictx,
            decoder,
            scaler,
            stream_index,
            width,
            height,
            current_time: 0.0,
            last_frame: None,
        })
    }

    pub fn frame_at(&mut self, time: f64) -> Result<DecodedVideoFrame, String> {
        let requested = time.max(0.0);
        if let Some(frame) = &self.last_frame {
            if (frame.time - requested).abs() < 0.001 {
                return Ok(frame.clone());
            }
        }
        if requested + 0.05 < self.current_time || (requested - self.current_time).abs() > 0.75 {
            self.seek(requested)?;
        }
        self.decode_until(requested)
    }

    fn seek(&mut self, time: f64) -> Result<(), String> {
        let ts = (time.max(0.0) * AV_TIME_BASE).round() as i64;
        let range = (ts - AV_TIME_BASE as i64)..(ts + AV_TIME_BASE as i64);
        self.ictx
            .seek(ts, range)
            .map_err(|e| format!("video seek {:.3}: {}", time, e))?;
        self.decoder.flush();
        self.current_time = time.max(0.0);
        self.last_frame = None;
        Ok(())
    }

    fn decode_until(&mut self, target_time: f64) -> Result<DecodedVideoFrame, String> {
        let mut decoded = Video::empty();
        loop {
            match self.decoder.receive_frame(&mut decoded) {
                Ok(()) => {
                    let frame = self.scale_frame(&decoded, target_time)?;
                    self.current_time = target_time;
                    self.last_frame = Some(frame.clone());
                    return Ok(frame);
                }
                Err(ffmpeg::Error::Other { errno }) if errno == ffmpeg::util::error::EAGAIN => {}
                Err(ffmpeg::Error::Eof) => {
                    if let Some(frame) = &self.last_frame {
                        return Ok(frame.clone());
                    }
                    return Err("video decoder reached eof".to_string());
                }
                Err(e) => return Err(format!("video receive frame: {}", e)),
            }

            let mut sent = false;
            for (stream, packet) in self.ictx.packets() {
                if stream.index() != self.stream_index {
                    continue;
                }
                self.decoder
                    .send_packet(&packet)
                    .map_err(|e| format!("video send packet: {}", e))?;
                sent = true;
                break;
            }
            if !sent {
                self.decoder
                    .send_eof()
                    .map_err(|e| format!("video send eof: {}", e))?;
            }
        }
    }

    fn scale_frame(&mut self, decoded: &Video, time: f64) -> Result<DecodedVideoFrame, String> {
        let mut rgba_frame = Video::empty();
        self.scaler
            .run(decoded, &mut rgba_frame)
            .map_err(|e| format!("video scale: {}", e))?;

        let row_bytes = (self.width * 4) as usize;
        let stride = rgba_frame.stride(0);
        let data = rgba_frame.data(0);
        let mut rgba = vec![0u8; row_bytes * self.height as usize];
        for row in 0..self.height as usize {
            let src_start = row * stride;
            let dst_start = row * row_bytes;
            rgba[dst_start..dst_start + row_bytes]
                .copy_from_slice(&data[src_start..src_start + row_bytes]);
        }
        Ok(DecodedVideoFrame {
            rgba,
            width: self.width,
            height: self.height,
            time,
        })
    }
}
