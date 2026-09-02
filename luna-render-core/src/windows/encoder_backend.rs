use windows::Win32::Graphics::Direct3D12::{ID3D12CommandQueue, ID3D12Device, ID3D12Resource};

use super::capabilities::EncoderCapabilities;
use super::encoder::D3d12VideoEncoder;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VideoCodec {
    H264,
    Hevc,
}

impl VideoCodec {
    pub(crate) fn is_hevc(self) -> bool {
        matches!(self, Self::Hevc)
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::H264 => "h264",
            Self::Hevc => "hevc",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EncoderBackendKind {
    D3d12Video,
    Nvenc,
    Amf,
    Qsv,
    Ffmpeg,
}

impl EncoderBackendKind {
    pub(crate) fn priority_order() -> &'static [Self] {
        &[
            Self::D3d12Video,
            Self::Nvenc,
            Self::Amf,
            Self::Qsv,
            Self::Ffmpeg,
        ]
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::D3d12Video => "d3d12-video",
            Self::Nvenc => "nvenc",
            Self::Amf => "amf",
            Self::Qsv => "qsv",
            Self::Ffmpeg => "ffmpeg",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GpuPixelFormat {
    Rgba8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EncoderPixelFormat {
    Nv12,
    P010,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct EncoderConfig {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) fps: f64,
    pub(crate) bitrate: u64,
}

/// The compositor's native output. It stays in an RGB format; encoder-specific
/// video formats are created by the shared GPU conversion layer.
pub(crate) struct GpuFrame {
    pub(crate) resource: ID3D12Resource,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) format: GpuPixelFormat,
}

impl GpuFrame {
    pub(crate) fn rgba8(resource: ID3D12Resource, width: u32, height: u32) -> Self {
        Self {
            resource,
            width,
            height,
            format: GpuPixelFormat::Rgba8,
        }
    }
}

/// A converted GPU surface owned by the encoder pipeline. This type is kept
/// separate from GpuFrame so the compositor contract never becomes NV12-only.
pub(crate) struct EncoderFrame {
    pub(crate) resource: ID3D12Resource,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) format: EncoderPixelFormat,
}

impl EncoderFrame {
    pub(crate) fn new(
        resource: ID3D12Resource,
        width: u32,
        height: u32,
        format: EncoderPixelFormat,
    ) -> Self {
        Self {
            resource,
            width,
            height,
            format,
        }
    }
}

pub(crate) struct EncodedPacket {
    pub(crate) data: Vec<u8>,
    pub(crate) frame_index: u64,
}

pub(crate) struct CodecHeaders {
    pub(crate) data: Vec<u8>,
}

pub(crate) trait EncoderBackend {
    fn kind(&self) -> EncoderBackendKind;
    fn codec(&self) -> VideoCodec;
    fn input_format(&self) -> EncoderPixelFormat;
    fn encode(&mut self, frame: EncoderFrame, frame_index: u64) -> Result<EncodedPacket, String>;
    fn flush(&mut self) -> Result<Vec<EncodedPacket>, String>;
    fn headers(&self) -> Result<CodecHeaders, String>;
}

pub(crate) struct EncoderManager {
    backend: Box<dyn EncoderBackend>,
}

fn select_codec(capabilities: EncoderCapabilities) -> Result<VideoCodec, String> {
    if capabilities.h264 {
        Ok(VideoCodec::H264)
    } else if capabilities.hevc {
        Ok(VideoCodec::Hevc)
    } else {
        Err("no usable D3D12 video encoder codec was found".to_string())
    }
}

impl EncoderManager {
    pub(crate) fn new(
        config: EncoderConfig,
        capabilities: EncoderCapabilities,
        device: &ID3D12Device,
        queue: &ID3D12CommandQueue,
    ) -> Result<Self, String> {
        let codec = select_codec(capabilities)?;
        let backend_order = EncoderBackendKind::priority_order()
            .iter()
            .map(|kind| kind.label())
            .collect::<Vec<_>>()
            .join(",");
        crate::logging::write(&format!(
            "[Export:WinGPU] encoder-manager backend-priority={} implemented=d3d12-video",
            backend_order,
        ));

        crate::logging::write(&format!(
            "[Export:WinGPU] encoder-manager selected backend={} codec={}",
            EncoderBackendKind::D3d12Video.label(),
            codec.label(),
        ));
        let backend = D3d12VideoEncoder::new(
            device,
            queue,
            config.width,
            config.height,
            config.fps,
            config.bitrate,
            codec.is_hevc(),
        )?;
        Ok(Self {
            backend: Box::new(backend),
        })
    }

    pub(crate) fn backend_kind(&self) -> EncoderBackendKind {
        self.backend.kind()
    }

    pub(crate) fn codec(&self) -> VideoCodec {
        self.backend.codec()
    }

    pub(crate) fn input_format(&self) -> EncoderPixelFormat {
        self.backend.input_format()
    }

    pub(crate) fn encode(
        &mut self,
        frame: EncoderFrame,
        frame_index: u64,
    ) -> Result<EncodedPacket, String> {
        self.backend.encode(frame, frame_index)
    }

    pub(crate) fn flush(&mut self) -> Result<Vec<EncodedPacket>, String> {
        self.backend.flush()
    }

    pub(crate) fn headers(&self) -> Result<CodecHeaders, String> {
        self.backend.headers()
    }
}

impl EncoderBackend for D3d12VideoEncoder {
    fn kind(&self) -> EncoderBackendKind {
        EncoderBackendKind::D3d12Video
    }

    fn codec(&self) -> VideoCodec {
        if self.is_hevc() {
            VideoCodec::Hevc
        } else {
            VideoCodec::H264
        }
    }

    fn input_format(&self) -> EncoderPixelFormat {
        EncoderPixelFormat::Nv12
    }

    fn encode(&mut self, frame: EncoderFrame, frame_index: u64) -> Result<EncodedPacket, String> {
        if frame.format != self.input_format()
            || frame.width != self.width()
            || frame.height != self.height()
        {
            return Err(format!(
                "D3D12 backend received incompatible frame: format={:?} size={}x{} expected format={:?} size={}x{}",
                frame.format,
                frame.width,
                frame.height,
                self.input_format(),
                self.width(),
                self.height(),
            ));
        }
        let data = self.append(&frame.resource, frame_index)?;
        Ok(EncodedPacket { data, frame_index })
    }

    fn flush(&mut self) -> Result<Vec<EncodedPacket>, String> {
        self.finish()?;
        Ok(Vec::new())
    }

    fn headers(&self) -> Result<CodecHeaders, String> {
        Ok(CodecHeaders {
            data: D3d12VideoEncoder::headers(self).to_vec(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{select_codec, EncoderBackendKind, EncoderCapabilities, VideoCodec};

    #[test]
    fn prefers_h264_when_both_codecs_are_available() {
        let capabilities = EncoderCapabilities {
            h264: true,
            hevc: true,
        };
        assert_eq!(select_codec(capabilities), Ok(VideoCodec::H264));
    }

    #[test]
    fn selects_hevc_when_h264_is_unavailable() {
        let capabilities = EncoderCapabilities {
            h264: false,
            hevc: true,
        };
        assert_eq!(select_codec(capabilities), Ok(VideoCodec::Hevc));
    }

    #[test]
    fn rejects_empty_codec_capabilities() {
        let capabilities = EncoderCapabilities {
            h264: false,
            hevc: false,
        };
        assert!(select_codec(capabilities).is_err());
    }

    #[test]
    fn backend_priority_reserves_vendor_fallback_slots() {
        assert_eq!(
            EncoderBackendKind::priority_order(),
            &[
                EncoderBackendKind::D3d12Video,
                EncoderBackendKind::Nvenc,
                EncoderBackendKind::Amf,
                EncoderBackendKind::Qsv,
                EncoderBackendKind::Ffmpeg,
            ]
        );
    }
}
