export const EFFECTS_WORKLET_NAME = "openreel-effects-processor";

export interface EffectWorkletParams {
  bypass: boolean;
  gain: number;
  compressorEnabled: boolean;
  compressorThreshold: number;
  compressorRatio: number;
  compressorAttack: number;
  compressorRelease: number;
  eqEnabled: boolean;
  eqLowGain: number;
  eqMidGain: number;
  eqHighGain: number;
}

export const DEFAULT_EFFECT_WORKLET_PARAMS: EffectWorkletParams = {
  bypass: false,
  gain: 1.0,
  compressorEnabled: false,
  compressorThreshold: -24,
  compressorRatio: 4,
  compressorAttack: 0.003,
  compressorRelease: 0.25,
  eqEnabled: false,
  eqLowGain: 0,
  eqMidGain: 0,
  eqHighGain: 0,
};

export const effectsWorkletCode = `
class OpenreelEffectsProcessor extends AudioWorkletProcessor {
 constructor(options) {
 super();

 this.bypass = false;
 this.gain = 1.0;

 this.compressorEnabled = false;
 this.compressorThreshold = -24;
 this.compressorRatio = 4;
 this.compressorAttack = 0.003;
 this.compressorRelease = 0.25;
 this.compressorEnvelope = 0;

 this.eqEnabled = false;
 this.eqLowGain = 0;
 this.eqMidGain = 0;
 this.eqHighGain = 0;

 this.lowpassState = [0, 0];
 this.highpassState = [0, 0];
 this.bandpassState = [0, 0];

 this.port.onmessage = (event) => {
 const { type, params } = event.data;
 if (type === 'updateParams') {
 this.updateParams(params);
 }
 };
 }

 updateParams(params) {
 if (params.bypass !== undefined) this.bypass = params.bypass;
 if (params.gain !== undefined) this.gain = params.gain;
 if (params.compressorEnabled !== undefined) this.compressorEnabled = params.compressorEnabled;
 if (params.compressorThreshold !== undefined) this.compressorThreshold = params.compressorThreshold;
 if (params.compressorRatio !== undefined) this.compressorRatio = params.compressorRatio;
 if (params.compressorAttack !== undefined) this.compressorAttack = params.compressorAttack;
 if (params.compressorRelease !== undefined) this.compressorRelease = params.compressorRelease;
 if (params.eqEnabled !== undefined) this.eqEnabled = params.eqEnabled;
 if (params.eqLowGain !== undefined) this.eqLowGain = params.eqLowGain;
 if (params.eqMidGain !== undefined) this.eqMidGain = params.eqMidGain;
 if (params.eqHighGain !== undefined) this.eqHighGain = params.eqHighGain;
 }

 dbToLinear(db) {
 return Math.pow(10, db / 20);
 }

 linearToDb(linear) {
 return 20 * Math.log10(Math.max(0.0001, linear));
 }

 processCompressor(sample) {
 const inputDb = this.linearToDb(Math.abs(sample));

 let gainReduction = 0;
 if (inputDb > this.compressorThreshold) {
 const overshoot = inputDb - this.compressorThreshold;
 gainReduction = overshoot * (1 - 1 / this.compressorRatio);
 }

 const attackCoeff = Math.exp(-1 / (sampleRate * this.compressorAttack));
 const releaseCoeff = Math.exp(-1 / (sampleRate * this.compressorRelease));

 if (gainReduction > this.compressorEnvelope) {
 this.compressorEnvelope = attackCoeff * this.compressorEnvelope + (1 - attackCoeff) * gainReduction;
 } else {
 this.compressorEnvelope = releaseCoeff * this.compressorEnvelope + (1 - releaseCoeff) * gainReduction;
 }

 const gainMultiplier = this.dbToLinear(-this.compressorEnvelope);
 return sample * gainMultiplier;
 }

 processEQ(sample, channel) {
 const lowCutoff = 200 / sampleRate;
 const highCutoff = 4000 / sampleRate;

 const lowAlpha = 1 - Math.exp(-2 * Math.PI * lowCutoff);
 this.lowpassState[channel] = this.lowpassState[channel] + lowAlpha * (sample - this.lowpassState[channel]);
 const lowFreq = this.lowpassState[channel];

 const highAlpha = 1 - Math.exp(-2 * Math.PI * (0.5 - highCutoff));
 this.highpassState[channel] = highAlpha * (this.highpassState[channel] + sample - this.bandpassState[channel]);
 this.bandpassState[channel] = sample;
 const highFreq = this.highpassState[channel];

 const midFreq = sample - lowFreq - highFreq;

 const lowGainLinear = this.dbToLinear(this.eqLowGain);
 const midGainLinear = this.dbToLinear(this.eqMidGain);
 const highGainLinear = this.dbToLinear(this.eqHighGain);

 return lowFreq * lowGainLinear + midFreq * midGainLinear + highFreq * highGainLinear;
 }

 process(inputs, outputs, parameters) {
 const input = inputs[0];
 const output = outputs[0];

 if (!input || !input.length) {
 return true;
 }

 for (let channel = 0; channel < output.length; channel++) {
 const inputChannel = input[channel] || input[0];
 const outputChannel = output[channel];

 for (let i = 0; i < outputChannel.length; i++) {
 let sample = inputChannel[i];

 if (this.bypass) {
 outputChannel[i] = sample;
 continue;
 }

 if (this.compressorEnabled) {
 sample = this.processCompressor(sample);
 }

 if (this.eqEnabled) {
 sample = this.processEQ(sample, channel);
 }

 sample *= this.gain;

 outputChannel[i] = Math.max(-1, Math.min(1, sample));
 }
 }

 return true;
 }
}

registerProcessor('${EFFECTS_WORKLET_NAME}', OpenreelEffectsProcessor);
`;

export function createEffectsWorkletBlob(): Blob {
  return new Blob([effectsWorkletCode], { type: "application/javascript" });
}

export function createEffectsWorkletUrl(): string {
  const blob = createEffectsWorkletBlob();
  return URL.createObjectURL(blob);
}

export async function loadEffectsWorklet(
  audioContext: AudioContext,
): Promise<void> {
  const workletUrl = createEffectsWorkletUrl();
  try {
    await audioContext.audioWorklet.addModule(workletUrl);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }
}

export function createEffectsWorkletNode(
  audioContext: AudioContext,
  params?: Partial<EffectWorkletParams>,
): AudioWorkletNode {
  const node = new AudioWorkletNode(audioContext, EFFECTS_WORKLET_NAME);

  if (params) {
    node.port.postMessage({ type: "updateParams", params });
  }

  return node;
}

export function updateEffectsWorkletParams(
  node: AudioWorkletNode,
  params: Partial<EffectWorkletParams>,
): void {
  node.port.postMessage({ type: "updateParams", params });
}
