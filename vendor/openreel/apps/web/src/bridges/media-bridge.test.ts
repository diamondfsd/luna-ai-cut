import { describe, it, expect, beforeEach, vi } from "vitest";
import { MediaBridge } from "./media-bridge";

const { mockImportMedia } = vi.hoisted(() => ({
  mockImportMedia: vi.fn(),
}));

vi.mock("@openreel/core", () => ({
  initializeMediaImportService: vi.fn().mockResolvedValue({
    importMedia: mockImportMedia,
    getSupportedFormats: vi
      .fn()
      .mockReturnValue(["mp4", "mov", "webm", "mp3", "wav"]),
  }),
  getWaveformGenerator: vi.fn().mockReturnValue({
    generateWaveform: vi.fn().mockResolvedValue({
      samples: new Float32Array(100).fill(0.5),
      sampleRate: 100,
    }),
  }),
  MediaImportService: vi.fn(),
  WaveformGenerator: vi.fn(),
}));

vi.mock("../stores/project-store", () => ({
  useProjectStore: {
    getState: vi.fn().mockReturnValue({
      project: {
        id: "test-project",
        mediaLibrary: { items: [] },
        timeline: {
          tracks: [],
          subtitles: [],
          duration: 0,
          markers: [],
        },
      },
    }),
  },
}));

describe("MediaBridge - Initialization", () => {
  let mediaBridge: MediaBridge;

  beforeEach(() => {
    mediaBridge = new MediaBridge();
    mockImportMedia.mockReset();
  });

  it("should start in uninitialized state", () => {
    expect(mediaBridge.isInitialized()).toBe(false);
  });

  it("should transition to initialized state after initialize()", async () => {
    await mediaBridge.initialize();

    expect(mediaBridge.isInitialized()).toBe(true);
  });

  it("should be idempotent - multiple initialize calls should not throw", async () => {
    await mediaBridge.initialize();
    await mediaBridge.initialize();
    await mediaBridge.initialize();

    expect(mediaBridge.isInitialized()).toBe(true);
  });
});

describe("MediaBridge - Import Validation", () => {
  let mediaBridge: MediaBridge;

  beforeEach(() => {
    mediaBridge = new MediaBridge();
    mockImportMedia.mockReset();
  });

  it("should reject import when not initialized", async () => {
    const file = new File(["test"], "video.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file);

    expect(result.success).toBe(false);
    expect(result.error).toBe("MediaBridge not initialized");
    expect(result.hasWaveform).toBe(false);
  });

  it("should pass file to import service when initialized", async () => {
    mockImportMedia.mockResolvedValue({
      success: true,
      media: {
        id: "imported-id",
        name: "test.mp4",
        type: "video",
        metadata: {
          duration: 10,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 1000000,
        },
        thumbnails: [],
        waveformData: null,
      },
      warnings: [],
    });

    await mediaBridge.initialize();
    const file = new File(["test content"], "video.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file);

    expect(mockImportMedia).toHaveBeenCalledTimes(1);
    expect(mockImportMedia).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        generateThumbnails: true,
        generateWaveform: true,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("should propagate import service errors", async () => {
    mockImportMedia.mockResolvedValue({
      success: false,
      error: "Unsupported codec",
      warnings: [],
    });

    await mediaBridge.initialize();
    const file = new File(["test"], "video.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unsupported codec");
  });

  it("should propagate warnings from import service", async () => {
    mockImportMedia.mockResolvedValue({
      success: true,
      media: {
        id: "id",
        name: "test.mp4",
        type: "video",
        metadata: {
          duration: 10,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 1000000,
        },
        thumbnails: [],
        waveformData: null,
      },
      warnings: ["Variable frame rate detected", "Audio track missing"],
    });

    await mediaBridge.initialize();
    const file = new File(["test"], "video.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file);

    expect(result.success).toBe(true);
    expect(result.warnings).toContain("Variable frame rate detected");
    expect(result.warnings).toContain("Audio track missing");
  });

  it("should respect generateWaveform parameter", async () => {
    mockImportMedia.mockResolvedValue({
      success: true,
      media: {
        id: "id",
        name: "audio.mp3",
        type: "audio",
        metadata: {
          duration: 60,
          width: 0,
          height: 0,
          frameRate: 0,
          codec: "mp3",
          sampleRate: 44100,
          channels: 2,
          fileSize: 500000,
        },
        thumbnails: [],
        waveformData: null,
      },
    });

    await mediaBridge.initialize();
    const file = new File(["test"], "audio.mp3", { type: "audio/mpeg" });

    await mediaBridge.importFile(file, false);

    expect(mockImportMedia).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        generateWaveform: false,
      }),
    );
  });
});

describe("MediaBridge - Metadata Extraction", () => {
  let mediaBridge: MediaBridge;

  beforeEach(() => {
    mediaBridge = new MediaBridge();
    mockImportMedia.mockReset();
  });

  it("should extract video metadata correctly", async () => {
    mockImportMedia.mockResolvedValue({
      success: true,
      media: {
        id: "video-id",
        name: "test-video.mp4",
        type: "video",
        metadata: {
          duration: 120.5,
          width: 3840,
          height: 2160,
          frameRate: 60,
          codec: "h265",
          sampleRate: 48000,
          channels: 2,
          fileSize: 50000000,
        },
        thumbnails: [],
        waveformData: null,
      },
    });

    await mediaBridge.initialize();
    const file = new File(["test"], "4k-video.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file);

    expect(result.success).toBe(true);
    expect(result.media?.metadata.duration).toBe(120.5);
    expect(result.media?.metadata.width).toBe(3840);
    expect(result.media?.metadata.height).toBe(2160);
    expect(result.media?.metadata.frameRate).toBe(60);
    expect(result.media?.metadata.codec).toBe("h265");
  });

  it("should extract audio metadata correctly", async () => {
    mockImportMedia.mockResolvedValue({
      success: true,
      media: {
        id: "audio-id",
        name: "test-audio.wav",
        type: "audio",
        metadata: {
          duration: 300,
          width: 0,
          height: 0,
          frameRate: 0,
          codec: "pcm",
          sampleRate: 96000,
          channels: 2,
          fileSize: 100000000,
        },
        thumbnails: [],
        waveformData: new Float32Array(100),
      },
    });

    await mediaBridge.initialize();
    const file = new File(["test"], "audio.wav", { type: "audio/wav" });

    const result = await mediaBridge.importFile(file);

    expect(result.success).toBe(true);
    expect(result.media?.metadata.duration).toBe(300);
    expect(result.media?.metadata.sampleRate).toBe(96000);
    expect(result.media?.metadata.channels).toBe(2);
    expect(result.media?.metadata.codec).toBe("pcm");
  });
});

describe("MediaBridge - Error Handling", () => {
  let mediaBridge: MediaBridge;

  beforeEach(() => {
    mediaBridge = new MediaBridge();
    mockImportMedia.mockReset();
  });

  it("should handle import service throwing exception", async () => {
    mockImportMedia.mockRejectedValue(new Error("Decode failed"));

    await mediaBridge.initialize();
    const file = new File(["test"], "corrupt.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Decode failed");
  });

  it("should handle missing media in response", async () => {
    mockImportMedia.mockResolvedValue({
      success: true,
      media: null,
    });

    await mediaBridge.initialize();
    const file = new File(["test"], "empty.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file);

    expect(result.success).toBe(false);
  });
});

describe("MediaBridge - Quick Mode Import", () => {
  let mediaBridge: MediaBridge;

  beforeEach(() => {
    mediaBridge = new MediaBridge();
    mockImportMedia.mockReset();
  });

  it("should pass quickMode=true to import service when specified", async () => {
    mockImportMedia.mockResolvedValue({
      success: true,
      media: {
        id: "large-file-id",
        name: "large-video.mp4",
        type: "video",
        metadata: {
          duration: 600,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 100000000,
        },
        thumbnails: [],
        waveformData: null,
      },
    });

    await mediaBridge.initialize();
    const file = new File(["test"], "large-video.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file, true, true);

    expect(mockImportMedia).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        quickMode: true,
        generateThumbnails: false,
        generateWaveform: false,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("should not skip thumbnails when quickMode is false", async () => {
    mockImportMedia.mockResolvedValue({
      success: true,
      media: {
        id: "normal-file-id",
        name: "video.mp4",
        type: "video",
        metadata: {
          duration: 10,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 1000000,
        },
        thumbnails: [{ timestamp: 0, dataUrl: "data:image/jpeg;base64,abc" }],
        waveformData: null,
      },
    });

    await mediaBridge.initialize();
    const file = new File(["test"], "video.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file, true, false);

    expect(mockImportMedia).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        quickMode: false,
        generateThumbnails: true,
        generateWaveform: true,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("should return success even without thumbnails in quick mode", async () => {
    mockImportMedia.mockResolvedValue({
      success: true,
      media: {
        id: "quick-import-id",
        name: "large-video.mp4",
        type: "video",
        metadata: {
          duration: 300,
          width: 3840,
          height: 2160,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 500000000,
        },
        thumbnails: [],
        waveformData: null,
      },
    });

    await mediaBridge.initialize();
    const file = new File(["test"], "4k-video.mp4", { type: "video/mp4" });

    const result = await mediaBridge.importFile(file, true, true);

    expect(result.success).toBe(true);
    expect(result.media?.thumbnails).toEqual([]);
    expect(result.hasWaveform).toBe(false);
  });
});
