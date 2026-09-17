import type { FrameCacheConfig, FrameCacheStats, CachedFrame } from "./types";

const DEFAULT_CONFIG: FrameCacheConfig = {
  maxFrames: 100,
  maxSizeBytes: 500 * 1024 * 1024, // 500MB
  preloadAhead: 30, // ~1 second at 30fps
  preloadBehind: 10,
};

export class FrameCache {
  private cache: Map<string, CachedFrame> = new Map();
  private config: FrameCacheConfig;
  private stats = { hits: 0, misses: 0 };
  private totalSizeBytes = 0;

  constructor(config: Partial<FrameCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  static getCacheKey(
    mediaId: string,
    time: number,
    frameRate: number = 30,
  ): string {
    // Round time to nearest frame
    const frameTime = Math.round(time * frameRate) / frameRate;
    return `${mediaId}:${frameTime.toFixed(4)}`;
  }

  get(key: string): ImageBitmap | null {
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastAccessed = Date.now();
      this.stats.hits++;
      return entry.image;
    }
    this.stats.misses++;
    return null;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  set(key: string, image: ImageBitmap, mediaId: string): void {
    // Estimate frame size (4 bytes per pixel for RGBA)
    const sizeBytes = image.width * image.height * 4;

    // Evict frames if needed
    this.evictIfNeeded(sizeBytes);

    // Don't cache if single frame exceeds max size
    if (sizeBytes > this.config.maxSizeBytes) {
      console.warn("Frame too large to cache:", sizeBytes, "bytes");
      return;
    }

    const timestamp = parseFloat(key.split(":")[1]) || 0;

    this.cache.set(key, {
      image,
      timestamp,
      mediaId,
      width: image.width,
      height: image.height,
      sizeBytes,
      lastAccessed: Date.now(),
    });

    this.totalSizeBytes += sizeBytes;
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      entry.image.close();
      this.totalSizeBytes -= entry.sizeBytes;
      return this.cache.delete(key);
    }
    return false;
  }

  clearMedia(mediaId: string): void {
    const keysToDelete: string[] = [];
    for (const [key, entry] of this.cache.entries()) {
      if (entry.mediaId === mediaId) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.delete(key);
    }
  }

  clear(): void {
    for (const entry of this.cache.values()) {
      entry.image.close();
    }
    this.cache.clear();
    this.totalSizeBytes = 0;
    this.stats = { hits: 0, misses: 0 };
  }

  getStats(): FrameCacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    return {
      entries: this.cache.size,
      sizeBytes: this.totalSizeBytes,
      hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
      maxSizeBytes: this.config.maxSizeBytes,
      hits: this.stats.hits,
      misses: this.stats.misses,
    };
  }

  getConfig(): FrameCacheConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<FrameCacheConfig>): void {
    this.config = { ...this.config, ...config };
    // Evict if new limits are exceeded
    this.evictIfNeeded(0);
  }

  getPreloadRange(
    mediaId: string,
    currentTime: number,
    duration: number,
    frameRate: number,
  ): { startTime: number; endTime: number; missingFrames: number[] } {
    const frameDuration = 1 / frameRate;
    const startTime = Math.max(
      0,
      currentTime - this.config.preloadBehind * frameDuration,
    );
    const endTime = Math.min(
      duration,
      currentTime + this.config.preloadAhead * frameDuration,
    );

    const missingFrames: number[] = [];
    for (let t = startTime; t <= endTime; t += frameDuration) {
      const key = FrameCache.getCacheKey(mediaId, t, frameRate);
      if (!this.cache.has(key)) {
        missingFrames.push(t);
      }
    }

    return { startTime, endTime, missingFrames };
  }

  prioritizeAroundTime(mediaId: string, time: number, frameRate: number): void {
    const frameDuration = 1 / frameRate;
    const now = Date.now();

    // Prioritize frames within preload range
    for (let offset = 0; offset <= this.config.preloadAhead; offset++) {
      const forwardKey = FrameCache.getCacheKey(
        mediaId,
        time + offset * frameDuration,
        frameRate,
      );
      const backwardKey = FrameCache.getCacheKey(
        mediaId,
        time - offset * frameDuration,
        frameRate,
      );

      const forwardEntry = this.cache.get(forwardKey);
      if (forwardEntry) {
        // Higher priority for frames closer to current time
        forwardEntry.lastAccessed = now + (this.config.preloadAhead - offset);
      }

      if (offset > 0) {
        const backwardEntry = this.cache.get(backwardKey);
        if (backwardEntry) {
          backwardEntry.lastAccessed =
            now + (this.config.preloadBehind - offset);
        }
      }
    }
  }

  private evictIfNeeded(newFrameSize: number): void {
    while (this.cache.size >= this.config.maxFrames) {
      this.evictOldest();
    }
    while (
      this.totalSizeBytes + newFrameSize > this.config.maxSizeBytes &&
      this.cache.size > 0
    ) {
      this.evictOldest();
    }
  }

  private evictOldest(): void {
    let oldestKey = "";
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
    }
  }

  getCachedTimestamps(mediaId: string): number[] {
    const timestamps: number[] = [];
    for (const entry of this.cache.values()) {
      if (entry.mediaId === mediaId) {
        timestamps.push(entry.timestamp);
      }
    }
    return timestamps.sort((a, b) => a - b);
  }

  getMemoryByMedia(): Map<string, number> {
    const memoryByMedia = new Map<string, number>();
    for (const entry of this.cache.values()) {
      const current = memoryByMedia.get(entry.mediaId) || 0;
      memoryByMedia.set(entry.mediaId, current + entry.sizeBytes);
    }
    return memoryByMedia;
  }
}

export interface PreloadTask {
  mediaId: string;
  media: Blob | File;
  timestamps: number[];
  priority: number;
  abortController: AbortController;
}

export class PreloadManager {
  private queue: PreloadTask[] = [];
  private currentTask: PreloadTask | null = null;

  enqueue(task: Omit<PreloadTask, "abortController">): AbortController {
    const abortController = new AbortController();
    const fullTask: PreloadTask = { ...task, abortController };
    this.cancelMedia(task.mediaId);
    this.queue.push(fullTask);
    this.queue.sort((a, b) => b.priority - a.priority);

    return abortController;
  }

  cancelMedia(mediaId: string): void {
    // Cancel current task if it matches
    if (this.currentTask?.mediaId === mediaId) {
      this.currentTask.abortController.abort();
      this.currentTask = null;
    }
    const index = this.queue.findIndex((t) => t.mediaId === mediaId);
    if (index !== -1) {
      this.queue[index].abortController.abort();
      this.queue.splice(index, 1);
    }
  }

  cancelAll(): void {
    if (this.currentTask) {
      this.currentTask.abortController.abort();
      this.currentTask = null;
    }

    for (const task of this.queue) {
      task.abortController.abort();
    }
    this.queue = [];
  }

  dequeue(): PreloadTask | null {
    return this.queue.shift() || null;
  }

  hasPendingTasks(): boolean {
    return this.queue.length > 0 || this.currentTask !== null;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  setCurrentTask(task: PreloadTask | null): void {
    this.currentTask = task;
  }

  getCurrentTask(): PreloadTask | null {
    return this.currentTask;
  }

  updatePriority(mediaId: string, priority: number): void {
    const task = this.queue.find((t) => t.mediaId === mediaId);
    if (task) {
      task.priority = priority;
      this.queue.sort((a, b) => b.priority - a.priority);
    }
  }
}
