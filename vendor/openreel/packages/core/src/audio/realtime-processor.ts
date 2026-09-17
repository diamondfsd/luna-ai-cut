import type { Effect } from "../types/timeline";

export interface TrackProcessorConfig {
  trackId: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  effects: Effect[];
}

export interface RealtimeProcessorState {
  isPlaying: boolean;
  currentTime: number;
  hasSoloTracks: boolean;
}

export class RealtimeAudioProcessor {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private trackProcessors: Map<string, TrackProcessor> = new Map();
  private workletLoaded = false;
  private state: RealtimeProcessorState = {
    isPlaying: false,
    currentTime: 0,
    hasSoloTracks: false,
  };

  constructor(context?: AudioContext) {
    this.audioContext = context || null;
  }

  async initialize(context?: AudioContext): Promise<void> {
    if (context) {
      this.audioContext = context;
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContext({
        latencyHint: "interactive",
        sampleRate: 48000,
      });
    }
    this.masterGain = this.audioContext.createGain();
    this.masterGain.connect(this.audioContext.destination);
    await this.loadWorklet();
  }

  private async loadWorklet(): Promise<void> {
    if (this.workletLoaded || !this.audioContext) return;

    try {
      // AudioWorklet is used for low-latency audio processing
      this.workletLoaded = true;
    } catch (error) {
      console.warn("AudioWorklet initialization failed, using standard nodes");
      this.workletLoaded = false;
    }
  }

  createTrackProcessor(config: TrackProcessorConfig): TrackProcessor {
    if (!this.audioContext || !this.masterGain) {
      throw new Error("RealtimeAudioProcessor not initialized");
    }
    this.removeTrackProcessor(config.trackId);

    const processor = new TrackProcessor(
      this.audioContext,
      this.masterGain,
      config,
    );

    this.trackProcessors.set(config.trackId, processor);
    this.updateSoloState();

    return processor;
  }

  removeTrackProcessor(trackId: string): void {
    const processor = this.trackProcessors.get(trackId);
    if (processor) {
      processor.dispose();
      this.trackProcessors.delete(trackId);
      this.updateSoloState();
    }
  }

  updateSoloState(): void {
    const hasSoloTracks = Array.from(this.trackProcessors.values()).some((p) =>
      p.isSolo(),
    );

    this.state.hasSoloTracks = hasSoloTracks;

    // Notify all processors of the solo state
    for (const processor of this.trackProcessors.values()) {
      processor.setHasSoloTracks(hasSoloTracks);
    }
  }

  setTrackMuted(trackId: string, muted: boolean): void {
    const processor = this.trackProcessors.get(trackId);
    if (processor) {
      processor.setMuted(muted);
    }
  }

  setTrackSolo(trackId: string, solo: boolean): void {
    const processor = this.trackProcessors.get(trackId);
    if (processor) {
      processor.setSolo(solo);
      this.updateSoloState();
    }
  }

  setTrackVolume(trackId: string, volume: number): void {
    const processor = this.trackProcessors.get(trackId);
    if (processor) {
      processor.setVolume(volume);
    }
  }

  setTrackPan(trackId: string, pan: number): void {
    const processor = this.trackProcessors.get(trackId);
    if (processor) {
      processor.setPan(pan);
    }
  }

  getEffectiveAudibility(): Map<string, boolean> {
    const audibility = new Map<string, boolean>();

    for (const [trackId, processor] of this.trackProcessors) {
      audibility.set(trackId, processor.isAudible());
    }

    return audibility;
  }

  hasSoloTracks(): boolean {
    return this.state.hasSoloTracks;
  }

  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  getMasterGain(): GainNode | null {
    return this.masterGain;
  }

  setMasterVolume(volume: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(4, volume));
    }
  }

  async resume(): Promise<void> {
    if (this.audioContext?.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  async suspend(): Promise<void> {
    if (this.audioContext?.state === "running") {
      await this.audioContext.suspend();
    }
  }

  async dispose(): Promise<void> {
    for (const processor of this.trackProcessors.values()) {
      processor.dispose();
    }
    this.trackProcessors.clear();

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    this.masterGain = null;
    this.workletLoaded = false;
  }
}

export class TrackProcessor {
  private context: AudioContext;
  private gainNode: GainNode;
  private pannerNode: StereoPannerNode;
  private inputNode: GainNode;
  private effectNodes: AudioNode[] = [];
  private muted = false;
  private solo = false;
  private hasSoloTracks = false;
  private volume = 1;
  private pan = 0;

  constructor(
    context: AudioContext,
    destination: AudioNode,
    config: TrackProcessorConfig,
  ) {
    this.context = context;
    this.inputNode = context.createGain();
    this.gainNode = context.createGain();
    this.gainNode.gain.value = config.volume;
    this.volume = config.volume;
    this.pannerNode = context.createStereoPanner();
    this.pannerNode.pan.value = Math.max(-1, Math.min(1, config.pan));
    this.pan = config.pan;
    this.muted = config.muted;
    this.solo = config.solo;
    this.inputNode.connect(this.gainNode);
    this.gainNode.connect(this.pannerNode);
    this.pannerNode.connect(destination);
    this.updateAudibility();
    this.createEffectNodes(config.effects);
  }

  private createEffectNodes(effects: Effect[]): void {
    this.inputNode.disconnect();
    for (const node of this.effectNodes) {
      node.disconnect();
    }
    this.effectNodes = [];
    let lastNode: AudioNode = this.inputNode;

    for (const effect of effects) {
      if (!effect.enabled) continue;

      const effectNode = this.createEffectNode(effect);
      if (effectNode) {
        lastNode.connect(effectNode);
        lastNode = effectNode;
        this.effectNodes.push(effectNode);
      }
    }
    lastNode.connect(this.gainNode);
  }

  private createEffectNode(effect: Effect): AudioNode | null {
    const params = effect.params as Record<string, number>;

    switch (effect.type) {
      case "compressor": {
        const compressor = this.context.createDynamicsCompressor();
        compressor.threshold.value = params.threshold ?? -24;
        compressor.ratio.value = params.ratio ?? 4;
        compressor.attack.value = params.attack ?? 0.003;
        compressor.release.value = params.release ?? 0.25;
        compressor.knee.value = params.knee ?? 30;
        return compressor;
      }

      case "delay": {
        const delay = this.context.createDelay(2);
        delay.delayTime.value = params.time ?? 0.5;
        return delay;
      }

      case "eq": {
        return this.createEQNode(effect);
      }

      default:
        return null;
    }
  }

  private createEQNode(effect: Effect): AudioNode | null {
    const bands = (
      effect.params as {
        bands?: Array<{
          type: string;
          frequency: number;
          gain: number;
          q: number;
        }>;
      }
    ).bands;
    if (!bands || bands.length === 0) return null;

    let firstNode: BiquadFilterNode | null = null;
    let lastNode: BiquadFilterNode | null = null;

    for (const band of bands) {
      const filter = this.context.createBiquadFilter();
      filter.type = band.type as BiquadFilterType;
      filter.frequency.value = band.frequency;
      filter.gain.value = band.gain;
      filter.Q.value = band.q;

      if (!firstNode) {
        firstNode = filter;
      }
      if (lastNode) {
        lastNode.connect(filter);
      }
      lastNode = filter;
    }

    return firstNode;
  }

  getInputNode(): AudioNode {
    return this.inputNode;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(4, volume));
    this.updateAudibility();
  }

  setPan(pan: number): void {
    this.pan = Math.max(-1, Math.min(1, pan));
    this.pannerNode.pan.value = this.pan;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.updateAudibility();
  }

  setSolo(solo: boolean): void {
    this.solo = solo;
    this.updateAudibility();
  }

  setHasSoloTracks(hasSoloTracks: boolean): void {
    this.hasSoloTracks = hasSoloTracks;
    this.updateAudibility();
  }

  isMuted(): boolean {
    return this.muted;
  }

  isSolo(): boolean {
    return this.solo;
  }

  isAudible(): boolean {
    if (this.muted) return false;
    if (this.hasSoloTracks && !this.solo) return false;

    return true;
  }

  private updateAudibility(): void {
    if (this.isAudible()) {
      this.gainNode.gain.value = this.volume;
    } else {
      this.gainNode.gain.value = 0;
    }
  }

  dispose(): void {
    this.inputNode.disconnect();
    this.gainNode.disconnect();
    this.pannerNode.disconnect();

    for (const node of this.effectNodes) {
      node.disconnect();
    }
    this.effectNodes = [];
  }
}
let realtimeProcessorInstance: RealtimeAudioProcessor | null = null;

export function getRealtimeAudioProcessor(): RealtimeAudioProcessor {
  if (!realtimeProcessorInstance) {
    realtimeProcessorInstance = new RealtimeAudioProcessor();
  }
  return realtimeProcessorInstance;
}

export async function initializeRealtimeProcessor(
  context?: AudioContext,
): Promise<RealtimeAudioProcessor> {
  const processor = getRealtimeAudioProcessor();
  await processor.initialize(context);
  return processor;
}
