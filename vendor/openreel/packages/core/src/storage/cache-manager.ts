import type { IStorageEngine, CacheRecord, WaveformRecord } from "./types";

export interface CacheManagerConfig {
  maxCacheSize: number;
  targetCacheSize: number;
  minEntries: number;
}

export const DEFAULT_CACHE_CONFIG: CacheManagerConfig = {
  maxCacheSize: 500 * 1024 * 1024, // 500MB
  targetCacheSize: 400 * 1024 * 1024, // 400MB (80%)
  minEntries: 10,
};

export interface CacheStats {
  readonly entries: number;
  readonly sizeBytes: number;
  readonly hitRate: number;
  readonly maxSizeBytes: number;
}

export class CacheManager {
  private storage: IStorageEngine;
  private config: CacheManagerConfig;
  private currentSize: number = 0;
  private entryCount: number = 0;
  private hits: number = 0;
  private misses: number = 0;

  constructor(
    storage: IStorageEngine,
    config: Partial<CacheManagerConfig> = {},
  ) {
    this.storage = storage;
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      entries: this.entryCount,
      sizeBytes: this.currentSize,
      hitRate: total > 0 ? this.hits / total : 0,
      maxSizeBytes: this.config.maxCacheSize,
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  async getFrame(
    projectId: string,
    clipId: string,
    time: number,
  ): Promise<ArrayBuffer | null> {
    const key = this.createFrameKey(projectId, clipId, time);
    const record = await this.storage.loadCache(key);

    if (record) {
      this.hits++;
      return record.data;
    }

    this.misses++;
    return null;
  }

  async setFrame(
    projectId: string,
    clipId: string,
    time: number,
    data: ArrayBuffer,
  ): Promise<void> {
    const key = this.createFrameKey(projectId, clipId, time);
    const size = data.byteLength;
    await this.ensureSpace(size);

    const record: CacheRecord = {
      key,
      data,
      timestamp: Date.now(),
      size,
    };

    await this.storage.saveCache(record);
    this.currentSize += size;
    this.entryCount++;
  }

  async deleteFrame(
    projectId: string,
    clipId: string,
    time: number,
  ): Promise<void> {
    const key = this.createFrameKey(projectId, clipId, time);
    const record = await this.storage.loadCache(key);

    if (record) {
      await this.storage.deleteCache(key);
      this.currentSize -= record.size;
      this.entryCount--;
    }
  }

  async getWaveform(mediaId: string): Promise<Float32Array | null> {
    const record = await this.storage.loadWaveform(mediaId);

    if (record) {
      this.hits++;
      return new Float32Array(record.data);
    }

    this.misses++;
    return null;
  }

  async setWaveform(
    mediaId: string,
    data: Float32Array,
    sampleRate: number,
  ): Promise<void> {
    const record: WaveformRecord = {
      mediaId,
      data: Array.from(data),
      sampleRate,
    };

    await this.storage.saveWaveform(record);
  }

  async deleteWaveform(mediaId: string): Promise<void> {
    await this.storage.deleteWaveform(mediaId);
  }

  async clearFrameCache(): Promise<void> {
    await this.storage.clearCache();
    this.currentSize = 0;
    this.entryCount = 0;
  }

  private async ensureSpace(needed: number): Promise<void> {
    if (this.currentSize + needed <= this.config.maxCacheSize) {
      return;
    }

    // Need to evict entries
    await this.evictToTarget(this.config.targetCacheSize - needed);
  }

  private async evictToTarget(targetSize: number): Promise<void> {
    if (this.entryCount <= this.config.minEntries) {
      return;
    }
    // This ensures memory stays within bounds while maintaining responsiveness
    if (this.currentSize > targetSize) {
      await this.clearFrameCache();
    }
  }

  private createFrameKey(
    projectId: string,
    clipId: string,
    time: number,
  ): string {
    return `${projectId}:${clipId}:${time.toFixed(3)}`;
  }

  parseFrameKey(key: string): {
    projectId: string;
    clipId: string;
    time: number;
  } | null {
    const parts = key.split(":");
    if (parts.length !== 3) {
      return null;
    }

    const time = parseFloat(parts[2]);
    if (isNaN(time)) {
      return null;
    }

    return {
      projectId: parts[0],
      clipId: parts[1],
      time,
    };
  }
}

export function createCacheManager(
  storage: IStorageEngine,
  config?: Partial<CacheManagerConfig>,
): CacheManager {
  return new CacheManager(storage, config);
}
