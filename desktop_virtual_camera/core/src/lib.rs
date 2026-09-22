//! Cross-platform primitives for the Luna desktop virtual camera.
//!
//! Platform adapters own transport input and system camera registration.
//! This crate owns protocol framing and frame representation only.

pub const LUNA_MAGIC: [u8; 4] = [0x55, 0x43, 0x44, 0x32];
pub const LUNA_MEDIA_TYPE: u8 = 0x01;
pub const LUNA_VIDEO_STREAM_TYPE: u8 = 0x20;

mod stream;

pub use stream::{FrameQueue, StreamDecoder, StreamStats};

/// Wrap one HEVC Annex-B access unit in the observed Luna UCD2 media frame.
/// The media trailer is reserved by the protocol and is intentionally zeroed.
pub fn encode_hevc_media_frame(sequence: u8, timestamp: u64, hevc: &[u8]) -> Vec<u8> {
    let raw_length = 9 + hevc.len();
    let mut frame = Vec::with_capacity(12 + raw_length + 4);
    frame.extend_from_slice(&LUNA_MAGIC);
    frame.extend_from_slice(&[0x01, 0x0c, LUNA_MEDIA_TYPE, sequence]);
    frame.extend_from_slice(&(raw_length as u32).to_le_bytes());
    frame.push(LUNA_VIDEO_STREAM_TYPE);
    frame.extend_from_slice(&timestamp.to_le_bytes());
    frame.extend_from_slice(hevc);
    frame.extend_from_slice(&[0, 0, 0, 0]);
    frame
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelFormat {
    Hevc,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VideoFrame {
    pub sequence: u8,
    pub timestamp: u64,
    pub format: PixelFormat,
    pub data: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum FrameError {
    Incomplete,
    InvalidMagic,
    InvalidLength,
    UnsupportedFrame,
    InvalidPayload,
}

/// Parse one complete Luna UCD2 media frame.
pub fn parse_media_frame(bytes: &[u8]) -> Result<VideoFrame, FrameError> {
    if bytes.len() < 25 {
        return Err(FrameError::Incomplete);
    }
    if bytes[0..4] != LUNA_MAGIC {
        return Err(FrameError::InvalidMagic);
    }
    if bytes[6] != LUNA_MEDIA_TYPE {
        return Err(FrameError::UnsupportedFrame);
    }
    let raw_length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    let total_length = 12 + raw_length + 4;
    if raw_length < 9 || total_length != bytes.len() {
        return Err(FrameError::InvalidLength);
    }
    let payload = &bytes[12..12 + raw_length];
    if payload[0] != LUNA_VIDEO_STREAM_TYPE {
        return Err(FrameError::UnsupportedFrame);
    }
    let timestamp = u64::from_le_bytes(payload[1..9].try_into().unwrap());
    let data = payload[9..].to_vec();
    if data.is_empty() {
        return Err(FrameError::InvalidPayload);
    }
    Ok(VideoFrame {
        sequence: bytes[7],
        timestamp,
        format: PixelFormat::Hevc,
        data,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_luna_hevc_media_frame() {
        let hevc = [0, 0, 0, 1, 0x40];
        let mut frame = vec![0x55, 0x43, 0x44, 0x32, 0x01, 0x0c, 0x01, 0x07];
        let raw_length = 9 + hevc.len() as u32;
        frame.extend(raw_length.to_le_bytes());
        frame.push(LUNA_VIDEO_STREAM_TYPE);
        frame.extend(123u64.to_le_bytes());
        frame.extend(hevc);
        frame.extend([0, 0, 0, 0]);

        let parsed = parse_media_frame(&frame).unwrap();
        assert_eq!(parsed.sequence, 7);
        assert_eq!(parsed.timestamp, 123);
        assert_eq!(parsed.data, vec![0, 0, 0, 1, 0x40]);
    }

    #[test]
    fn encodes_a_round_trip_hevc_media_frame() {
        let hevc = [0, 0, 0, 1, 0x40, 0xaa];
        let frame = encode_hevc_media_frame(9, 456, &hevc);
        let parsed = parse_media_frame(&frame).unwrap();
        assert_eq!(parsed.sequence, 9);
        assert_eq!(parsed.timestamp, 456);
        assert_eq!(parsed.data, hevc);
    }
}
