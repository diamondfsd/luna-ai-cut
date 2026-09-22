use std::collections::VecDeque;

use crate::{parse_media_frame, FrameError, VideoFrame, LUNA_MAGIC};

const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct StreamStats {
    pub frames_received: u64,
    pub frames_rejected: u64,
    pub bytes_received: u64,
    pub bytes_dropped: u64,
}

/// Incremental decoder for arbitrary transport chunks. It handles partial frames,
/// multiple frames in one read, and garbage before the next UCD2 magic.
#[derive(Debug, Default)]
pub struct StreamDecoder {
    pending: Vec<u8>,
    stats: StreamStats,
}

impl StreamDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn stats(&self) -> StreamStats {
        self.stats
    }

    pub fn push(&mut self, chunk: &[u8]) -> Vec<VideoFrame> {
        self.stats.bytes_received += chunk.len() as u64;
        self.pending.extend_from_slice(chunk);
        let mut frames = Vec::new();

        loop {
            let Some(magic_index) = find_magic(&self.pending) else {
                let keep = self.pending.len().min(LUNA_MAGIC.len() - 1);
                let drop_count = self.pending.len().saturating_sub(keep);
                self.stats.bytes_dropped += drop_count as u64;
                self.pending.drain(..drop_count);
                break;
            };
            if magic_index > 0 {
                self.stats.bytes_dropped += magic_index as u64;
                self.pending.drain(..magic_index);
            }
            if self.pending.len() < 12 {
                break;
            }

            let raw_length = u32::from_le_bytes(self.pending[8..12].try_into().unwrap()) as usize;
            let total_length = 12usize.saturating_add(raw_length).saturating_add(4);
            if raw_length < 9 || total_length > MAX_FRAME_BYTES {
                self.stats.frames_rejected += 1;
                self.pending.drain(..LUNA_MAGIC.len());
                continue;
            }
            if self.pending.len() < total_length {
                break;
            }

            let candidate = self.pending.drain(..total_length).collect::<Vec<_>>();
            match parse_media_frame(&candidate) {
                Ok(frame) => {
                    self.stats.frames_received += 1;
                    frames.push(frame);
                }
                Err(FrameError::UnsupportedFrame) => {}
                Err(_) => self.stats.frames_rejected += 1,
            }
        }
        frames
    }
}

/// Small latest-frame queue. Dropping old frames keeps live preview latency low.
#[derive(Debug)]
pub struct FrameQueue {
    capacity: usize,
    frames: VecDeque<VideoFrame>,
    dropped: u64,
}

impl FrameQueue {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            frames: VecDeque::new(),
            dropped: 0,
        }
    }

    pub fn push(&mut self, frame: VideoFrame) {
        if self.frames.len() == self.capacity {
            self.frames.pop_front();
            self.dropped += 1;
        }
        self.frames.push_back(frame);
    }

    pub fn pop(&mut self) -> Option<VideoFrame> {
        self.frames.pop_front()
    }

    pub fn latest(&mut self) -> Option<VideoFrame> {
        let latest = self.frames.pop_back();
        self.frames.clear();
        latest
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn dropped(&self) -> u64 {
        self.dropped
    }
}

fn find_magic(bytes: &[u8]) -> Option<usize> {
    bytes
        .windows(LUNA_MAGIC.len())
        .position(|window| window == LUNA_MAGIC)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PixelFormat, LUNA_VIDEO_STREAM_TYPE};

    fn frame() -> Vec<u8> {
        let hevc = [0, 0, 0, 1, 0x40];
        let mut bytes = vec![0x55, 0x43, 0x44, 0x32, 1, 0x0c, 1, 3];
        bytes.extend((9u32 + hevc.len() as u32).to_le_bytes());
        bytes.push(LUNA_VIDEO_STREAM_TYPE);
        bytes.extend(987u64.to_le_bytes());
        bytes.extend(hevc);
        bytes.extend([0, 0, 0, 0]);
        bytes
    }

    #[test]
    fn decodes_split_and_coalesced_chunks() {
        let bytes = frame();
        let mut decoder = StreamDecoder::new();
        assert!(decoder.push(&bytes[..7]).is_empty());
        let mut second = bytes[7..].to_vec();
        second.extend_from_slice(&bytes);
        let frames = decoder.push(&second);
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].format, PixelFormat::Hevc);
        assert_eq!(decoder.stats().frames_received, 2);
    }

    #[test]
    fn queue_drops_old_frames() {
        let mut queue = FrameQueue::new(2);
        for sequence in 0..3 {
            queue.push(crate::VideoFrame {
                sequence,
                timestamp: sequence as u64,
                format: PixelFormat::Hevc,
                data: vec![0, 0, 0, 1, 0x40],
            });
        }
        assert_eq!(queue.len(), 2);
        assert_eq!(queue.dropped(), 1);
        assert_eq!(queue.latest().unwrap().sequence, 2);
    }
}
