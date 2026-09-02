use windows::Win32::Graphics::Direct3D12::{ID3D12CommandQueue, ID3D12Device, ID3D12Resource};

use super::nvenc::NvencEncoder;

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
    Nvenc,
    Amf,
    Qsv,
    Ffmpeg,
}

impl EncoderBackendKind {
    pub(crate) fn priority_order() -> &'static [Self] {
        &[Self::Nvenc, Self::Amf, Self::Qsv, Self::Ffmpeg]
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
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
    Bgra8,
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

impl EncoderManager {
    pub(crate) fn new(
        config: EncoderConfig,
        device: &ID3D12Device,
        queue: &ID3D12CommandQueue,
    ) -> Result<Self, String> {
        let backend_order = EncoderBackendKind::priority_order()
            .iter()
            .map(|kind| kind.label())
            .collect::<Vec<_>>()
            .join(",");
        crate::logging::write(&format!(
            "[Export:WinGPU] encoder-manager backend-priority={} implemented=nvenc",
            backend_order,
        ));

        let backend = NvencEncoder::new(device, queue, config).map_err(|nvenc_error| {
            format!(
                "no vendor GPU encoder is available; nvenc={nvenc_error}; amf=not implemented; qsv=not implemented"
            )
        })?;
        crate::logging::write("[Export:WinGPU] encoder-manager selected backend=nvenc codec=h264");
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

#[cfg(test)]
mod tests {
    use super::EncoderBackendKind;

    #[test]
    fn backend_priority_reserves_vendor_fallback_slots() {
        assert_eq!(
            EncoderBackendKind::priority_order(),
            &[
                EncoderBackendKind::Nvenc,
                EncoderBackendKind::Amf,
                EncoderBackendKind::Qsv,
                EncoderBackendKind::Ffmpeg,
            ]
        );
    }
}
