import type { MediaItem } from "../types/project";

export type PlaybackEngineState =
  | "idle"
  | "buffering"
  | "playing"
  | "paused"
  | "seeking";

export type FrameCallback = (frame: ImageBitmap, timestamp: number) => void;

export interface PlaybackEngineConfig {
  frameRate: number;
  width: number;
  height: number;
  bufferAhead: number;
  onFrame: FrameCallback;
  onStateChange?: (state: PlaybackEngineState) => void;
  onTimeUpdate?: (time: number) => void;
}

interface BufferedFrame {
  frame: ImageBitmap;
  timestamp: number;
}

interface ActiveStream {
  mediaId: string;
  clipId: string;
  input: { [Symbol.dispose]?: () => void };
  sink: AsyncGenerator<unknown, void, unknown>;
  startTime: number;
  endTime: number;
  inPoint: number;
}

export class PlaybackEngine {
  private mediabunny: typeof import("mediabunny") | null = null;
  private initialized = false;
  private config: PlaybackEngineConfig | null = null;

  // Playback state
  private state: PlaybackEngineState = "idle";
  private currentTime = 0;
  private playbackRate = 1.0;

  // Frame buffer for smooth playback
  private frameBuffer: BufferedFrame[] = [];
  private maxBufferSize = 60; // ~2 seconds at 30fps

  // Active streams for current clips
  private activeStreams: Map<string, ActiveStream> = new Map();

  // Animation frame handling
  private animationFrameId: number | null = null;
  private lastFrameTime = 0;

  // Decoding worker
  private decodingActive = false;
  private decodingAbortController: AbortController | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.mediabunny = await import("mediabunny");
      this.initialized = true;
    } catch (error) {
      throw new Error(
        "PlaybackEngine initialization failed: MediaBunny not available",
      );
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  configure(config: PlaybackEngineConfig): void {
    this.config = config;
    this.maxBufferSize = config.bufferAhead || 60;
  }

  getState(): PlaybackEngineState {
    return this.state;
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.1, Math.min(4.0, rate));
  }

  async play(
    mediaItems: Map<string, MediaItem>,
    clips: Array<{
      clipId: string;
      mediaId: string;
      startTime: number;
      duration: number;
      inPoint: number;
    }>,
    startTime: number = 0,
  ): Promise<void> {
    if (!this.initialized || !this.mediabunny || !this.config) {
      throw new Error("PlaybackEngine not initialized or configured");
    }

    this.setState("buffering");
    this.currentTime = startTime;
    await this.stop();
    await this.setupStreams(mediaItems, clips, startTime);
    this.startDecoding(mediaItems, clips);

    // Wait for initial buffer
    await this.waitForBuffer(this.config.bufferAhead / 2);
    this.setState("playing");
    this.lastFrameTime = performance.now();
    this.startPlaybackLoop();
  }

  pause(): void {
    if (this.state === "playing") {
      this.setState("paused");
      this.stopPlaybackLoop();
    }
  }

  resume(): void {
    if (this.state === "paused") {
      this.setState("playing");
      this.lastFrameTime = performance.now();
      this.startPlaybackLoop();
    }
  }

  async stop(): Promise<void> {
    this.stopPlaybackLoop();
    this.stopDecoding();
    this.clearStreams();
    this.clearBuffer();
    this.setState("idle");
    this.currentTime = 0;
  }

  async seek(
    time: number,
    mediaItems: Map<string, MediaItem>,
    clips: Array<{
      clipId: string;
      mediaId: string;
      startTime: number;
      duration: number;
      inPoint: number;
    }>,
  ): Promise<void> {
    const wasPlaying = this.state === "playing";

    this.setState("seeking");
    this.stopPlaybackLoop();
    this.stopDecoding();
    this.clearBuffer();

    this.currentTime = time;

    // Re-setup streams for new position
    await this.setupStreams(mediaItems, clips, time);
    this.startDecoding(mediaItems, clips);
    const frame = await this.getImmediateFrame(mediaItems, clips, time);
    if (frame && this.config) {
      this.config.onFrame(frame.frame, frame.timestamp);
    }

    if (wasPlaying) {
      // Wait for buffer then resume
      await this.waitForBuffer(
        this.config?.bufferAhead ? this.config.bufferAhead / 4 : 15,
      );
      this.setState("playing");
      this.lastFrameTime = performance.now();
      this.startPlaybackLoop();
    } else {
      this.setState("paused");
    }
  }

  private async setupStreams(
    mediaItems: Map<string, MediaItem>,
    clips: Array<{
      clipId: string;
      mediaId: string;
      startTime: number;
      duration: number;
      inPoint: number;
    }>,
    time: number,
  ): Promise<void> {
    this.clearStreams();

    const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } =
      this.mediabunny!;
    const relevantClips = clips.filter((clip) => {
      const clipEnd = clip.startTime + clip.duration;
      return clipEnd > time;
    });

    for (const clip of relevantClips) {
      const mediaItem = mediaItems.get(clip.mediaId);
      if (!mediaItem?.blob) continue;

      try {
        const input = new Input({
          source: new BlobSource(mediaItem.blob),
          formats: ALL_FORMATS,
        });

        const videoTrack = await input.getPrimaryVideoTrack();
        if (!videoTrack) {
          input[Symbol.dispose]?.();
          continue;
        }

        const canDecode = await videoTrack.canDecode();
        if (!canDecode) {
          input[Symbol.dispose]?.();
          continue;
        }
        const clipLocalTime = Math.max(0, time - clip.startTime);
        const mediaStartTime = clip.inPoint + clipLocalTime;
        const mediaEndTime = clip.inPoint + clip.duration;

        const sinkInstance = new VideoSampleSink(videoTrack);
        const samplesIterator = sinkInstance.samples(
          mediaStartTime,
          mediaEndTime,
        );

        this.activeStreams.set(clip.clipId, {
          mediaId: clip.mediaId,
          clipId: clip.clipId,
          input,
          sink: samplesIterator,
          startTime: clip.startTime,
          endTime: clip.startTime + clip.duration,
          inPoint: clip.inPoint,
        });
      } catch (error) {
        console.warn(`Failed to setup stream for clip ${clip.clipId}:`, error);
      }
    }
  }

  private startDecoding(
    mediaItems: Map<string, MediaItem>,
    clips: Array<{
      clipId: string;
      mediaId: string;
      startTime: number;
      duration: number;
      inPoint: number;
    }>,
  ): void {
    if (this.decodingActive) return;

    this.decodingActive = true;
    this.decodingAbortController = new AbortController();

    this.decodeLoop(mediaItems, clips, this.decodingAbortController.signal);
  }

  private stopDecoding(): void {
    this.decodingActive = false;
    this.decodingAbortController?.abort();
    this.decodingAbortController = null;
  }

  private async decodeLoop(
    _mediaItems: Map<string, MediaItem>,
    _clips: Array<{
      clipId: string;
      mediaId: string;
      startTime: number;
      duration: number;
      inPoint: number;
    }>,
    signal: AbortSignal,
  ): Promise<void> {
    while (this.decodingActive && !signal.aborted) {
      if (this.frameBuffer.length >= this.maxBufferSize) {
        await this.sleep(16); // Wait ~1 frame
        continue;
      }
      let gotFrame = false;

      for (const [clipId, stream] of this.activeStreams) {
        if (signal.aborted) break;

        try {
          const result = await stream.sink.next();

          if (result.done) {
            // Stream exhausted, remove it
            stream.input[Symbol.dispose]?.();
            this.activeStreams.delete(clipId);
            continue;
          }

          const sample = result.value as {
            timestamp: number;
            displayWidth: number;
            displayHeight: number;
            close: () => void;
            toVideoFrame?: () => VideoFrame;
          };

          if (sample) {
            let imageBitmap: ImageBitmap;

            try {
              if (typeof sample.toVideoFrame === "function") {
                const videoFrame = sample.toVideoFrame();
                imageBitmap = await createImageBitmap(videoFrame);
                videoFrame.close();
              } else {
                // Sample is a VideoFrame-like object
                imageBitmap = await createImageBitmap(
                  sample as unknown as VideoFrame,
                );
              }
            } catch {
              const canvas = new OffscreenCanvas(
                sample.displayWidth,
                sample.displayHeight,
              );
              const ctx = canvas.getContext("2d");
              const sampleWithDraw = sample as unknown as {
                draw?: (
                  ctx: OffscreenCanvasRenderingContext2D,
                  x: number,
                  y: number,
                ) => void;
              };
              if (ctx && typeof sampleWithDraw.draw === "function") {
                sampleWithDraw.draw(ctx, 0, 0);
                imageBitmap = await createImageBitmap(canvas);
              } else {
                sample.close();
                continue;
              }
            }
            const mediaTime = sample.timestamp / 1_000_000;
            const timelineTime =
              stream.startTime + (mediaTime - stream.inPoint);
            this.insertFrameInBuffer({
              frame: imageBitmap,
              timestamp: timelineTime,
            });

            sample.close();
            gotFrame = true;
          }
        } catch (error) {
          if (!signal.aborted) {
            console.warn(`Decode error for clip ${clipId}:`, error);
          }
        }
      }
      if (!gotFrame) {
        await this.sleep(8);
      }
    }
  }

  private insertFrameInBuffer(frame: BufferedFrame): void {
    // Binary search for insertion point
    let low = 0;
    let high = this.frameBuffer.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.frameBuffer[mid].timestamp < frame.timestamp) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    this.frameBuffer.splice(low, 0, frame);

    // Trim buffer if too large
    while (this.frameBuffer.length > this.maxBufferSize) {
      const removed = this.frameBuffer.shift();
      removed?.frame.close();
    }
  }

  private startPlaybackLoop(): void {
    if (this.animationFrameId !== null) return;

    const loop = (currentTime: number) => {
      if (this.state !== "playing") return;

      const deltaTime = (currentTime - this.lastFrameTime) / 1000;
      this.lastFrameTime = currentTime;

      // Advance playback time
      this.currentTime += deltaTime * this.playbackRate;

      // Notify time update
      this.config?.onTimeUpdate?.(this.currentTime);
      this.displayFrame(this.currentTime);

      // Continue loop
      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  private stopPlaybackLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private displayFrame(time: number): void {
    if (this.frameBuffer.length === 0 || !this.config) return;
    let frameIndex = -1;
    for (let i = this.frameBuffer.length - 1; i >= 0; i--) {
      if (this.frameBuffer[i].timestamp <= time) {
        frameIndex = i;
        break;
      }
    }

    if (frameIndex >= 0) {
      const frame = this.frameBuffer[frameIndex];
      this.config.onFrame(frame.frame, frame.timestamp);
      const removed = this.frameBuffer.splice(0, frameIndex + 1);
      for (const f of removed) {
        // Don't close the frame we just displayed - it might still be in use
        if (f !== frame) {
          f.frame.close();
        }
      }
    }
  }

  private async getImmediateFrame(
    mediaItems: Map<string, MediaItem>,
    clips: Array<{
      clipId: string;
      mediaId: string;
      startTime: number;
      duration: number;
      inPoint: number;
    }>,
    time: number,
  ): Promise<BufferedFrame | null> {
    const { Input, ALL_FORMATS, BlobSource, CanvasSink } = this.mediabunny!;
    const clip = clips.find((c) => {
      const clipEnd = c.startTime + c.duration;
      return time >= c.startTime && time < clipEnd;
    });

    if (!clip) return null;

    const mediaItem = mediaItems.get(clip.mediaId);
    if (!mediaItem?.blob) return null;

    const input = new Input({
      source: new BlobSource(mediaItem.blob),
      formats: ALL_FORMATS,
    });

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) return null;

      const canDecode = await videoTrack.canDecode();
      if (!canDecode) return null;
      const clipLocalTime = time - clip.startTime;
      const mediaTime = clip.inPoint + clipLocalTime;

      const sink = new CanvasSink(videoTrack, {
        width: this.config?.width,
        height: this.config?.height,
        fit: "contain",
        poolSize: 1,
      });

      const result = await sink.getCanvas(mediaTime);
      if (!result) return null;
      const imageBitmap = await createImageBitmap(result.canvas);

      return {
        frame: imageBitmap,
        timestamp: time,
      };
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  private async waitForBuffer(minFrames: number): Promise<void> {
    const timeout = 5000; // 5 second timeout
    const startTime = Date.now();

    while (this.frameBuffer.length < minFrames) {
      if (Date.now() - startTime > timeout) {
        console.warn("Buffer timeout - starting playback with partial buffer");
        break;
      }
      await this.sleep(16);
    }
  }

  private clearStreams(): void {
    for (const stream of this.activeStreams.values()) {
      stream.input[Symbol.dispose]?.();
    }
    this.activeStreams.clear();
  }

  private clearBuffer(): void {
    for (const frame of this.frameBuffer) {
      frame.frame.close();
    }
    this.frameBuffer = [];
  }

  private setState(state: PlaybackEngineState): void {
    this.state = state;
    this.config?.onStateChange?.(state);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  dispose(): void {
    this.stop();
    this.initialized = false;
    this.mediabunny = null;
  }
}
let playbackEngineInstance: PlaybackEngine | null = null;

export function getPlaybackEngine(): PlaybackEngine {
  if (!playbackEngineInstance) {
    playbackEngineInstance = new PlaybackEngine();
  }
  return playbackEngineInstance;
}

export async function initializePlaybackEngine(): Promise<PlaybackEngine> {
  const engine = getPlaybackEngine();
  await engine.initialize();
  return engine;
}
