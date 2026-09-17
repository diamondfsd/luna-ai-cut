import { FFT } from "../audio/fft";

export interface MulticamDriftObservation {
  timeSeconds: number;
  offsetSeconds: number;
  confidence: number;
}

export interface MulticamDriftModel {
  /** Offset at timeline time zero. */
  interceptSeconds: number;
  /** Additional source seconds accumulated per timeline second. */
  secondsPerSecond: number;
  partsPerMillion: number;
  confidence: number;
  observations: MulticamDriftObservation[];
}

export interface MulticamDriftAnalysisOptions {
  blockSeconds?: number;
  intervalSeconds?: number;
  maxOffsetSeconds?: number;
  analysisSampleRate?: number;
}

const nextPowerOfTwo = (value: number): number => {
  let result = 1;
  while (result < value) result *= 2;
  return result;
};

function resampleAt(
  samples: Float32Array,
  sampleRate: number,
  startTime: number,
  duration: number,
  targetRate: number,
): Float32Array {
  const length = Math.max(0, Math.floor(duration * targetRate));
  const result = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const position = (startTime + index / targetRate) * sampleRate;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    if (left < 0 || left >= samples.length) continue;
    const fraction = position - left;
    result[index] =
      (samples[left] ?? 0) * (1 - fraction) + (samples[right] ?? 0) * fraction;
  }
  return result;
}

function removeMean(samples: Float32Array): Float32Array {
  if (samples.length === 0) return samples;
  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;
  return Float32Array.from(samples, (sample) => sample - mean);
}

function fftBlockOffset(
  reference: Float32Array,
  target: Float32Array,
  maxOffsetSamples: number,
  sampleRate: number,
): { offsetSeconds: number; confidence: number } {
  if (reference.length === 0 || target.length < reference.length) {
    return { offsetSeconds: 0, confidence: 0 };
  }
  const centeredReference = removeMean(reference);
  const centeredTarget = removeMean(target);
  const fftSize = nextPowerOfTwo(centeredReference.length + centeredTarget.length - 1);
  const reversedReference = new Float32Array(fftSize);
  for (let index = 0; index < centeredReference.length; index++) {
    reversedReference[index] = centeredReference[centeredReference.length - 1 - index] ?? 0;
  }
  const paddedTarget = new Float32Array(fftSize);
  paddedTarget.set(centeredTarget);

  const fft = new FFT(fftSize);
  const referenceSpectrum = fft.forward(reversedReference);
  const targetSpectrum = fft.forward(paddedTarget);
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  for (let index = 0; index < fftSize; index++) {
    real[index] =
      targetSpectrum.real[index] * referenceSpectrum.real[index] -
      targetSpectrum.imag[index] * referenceSpectrum.imag[index];
    imag[index] =
      targetSpectrum.real[index] * referenceSpectrum.imag[index] +
      targetSpectrum.imag[index] * referenceSpectrum.real[index];
  }
  const correlation = fft.inverse(real, imag);

  let referenceEnergy = 0;
  for (const sample of centeredReference) referenceEnergy += sample * sample;
  const energyPrefix = new Float64Array(centeredTarget.length + 1);
  for (let index = 0; index < centeredTarget.length; index++) {
    const sample = centeredTarget[index] ?? 0;
    energyPrefix[index + 1] = (energyPrefix[index] ?? 0) + sample * sample;
  }

  let bestLag = 0;
  let bestScore = -1;
  for (let lag = -maxOffsetSamples; lag <= maxOffsetSamples; lag++) {
    const targetStart = maxOffsetSamples + lag;
    const targetEnd = targetStart + centeredReference.length;
    if (targetStart < 0 || targetEnd > centeredTarget.length) continue;
    const targetEnergy =
      (energyPrefix[targetEnd] ?? 0) - (energyPrefix[targetStart] ?? 0);
    const denominator = Math.sqrt(referenceEnergy * targetEnergy);
    const convolutionIndex = targetStart + centeredReference.length - 1;
    const score = denominator > 0 ? (correlation[convolutionIndex] ?? 0) / denominator : 0;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return {
    offsetSeconds: bestLag / sampleRate,
    confidence: Math.max(0, Math.min(1, bestScore)),
  };
}

export function fitMulticamDriftModel(
  observations: readonly MulticamDriftObservation[],
): MulticamDriftModel {
  const valid = observations.filter(
    (entry) =>
      Number.isFinite(entry.timeSeconds) &&
      Number.isFinite(entry.offsetSeconds) &&
      Number.isFinite(entry.confidence) &&
      entry.confidence > 0,
  );
  if (valid.length === 0) {
    return {
      interceptSeconds: 0,
      secondsPerSecond: 0,
      partsPerMillion: 0,
      confidence: 0,
      observations: [],
    };
  }
  let weight = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (const entry of valid) {
    weight += entry.confidence;
    weightedX += entry.timeSeconds * entry.confidence;
    weightedY += entry.offsetSeconds * entry.confidence;
  }
  const meanX = weightedX / weight;
  const meanY = weightedY / weight;
  let covariance = 0;
  let variance = 0;
  for (const entry of valid) {
    const x = entry.timeSeconds - meanX;
    covariance += entry.confidence * x * (entry.offsetSeconds - meanY);
    variance += entry.confidence * x * x;
  }
  const secondsPerSecond = variance > 0 ? covariance / variance : 0;
  const interceptSeconds = meanY - secondsPerSecond * meanX;
  const confidence = weight / valid.length;
  return {
    interceptSeconds,
    secondsPerSecond,
    partsPerMillion: secondsPerSecond * 1_000_000,
    confidence: Math.max(0, Math.min(1, confidence)),
    observations: valid.map((entry) => ({ ...entry })),
  };
}

export function multicamOffsetAt(
  model: Pick<MulticamDriftModel, "interceptSeconds" | "secondsPerSecond">,
  timelineTime: number,
): number {
  return model.interceptSeconds + model.secondsPerSecond * timelineTime;
}

export function multicamSourceTime(
  model: Pick<MulticamDriftModel, "interceptSeconds" | "secondsPerSecond">,
  timelineTime: number,
): number {
  return timelineTime + multicamOffsetAt(model, timelineTime);
}

/** Measures block offsets with FFT cross-correlation, then fits linear clock drift. */
export function analyzeMulticamDrift(
  reference: Float32Array,
  target: Float32Array,
  sampleRate: number,
  options: MulticamDriftAnalysisOptions = {},
): MulticamDriftModel {
  const blockSeconds = Math.max(1, options.blockSeconds ?? 5);
  const intervalSeconds = Math.max(blockSeconds, options.intervalSeconds ?? 300);
  const maxOffsetSeconds = Math.max(0.05, options.maxOffsetSeconds ?? 2);
  const analysisSampleRate = Math.max(100, options.analysisSampleRate ?? 400);
  const duration = Math.min(reference.length, target.length) / sampleRate;
  const observations: MulticamDriftObservation[] = [];
  for (
    let startTime = maxOffsetSeconds;
    startTime + blockSeconds + maxOffsetSeconds <= duration;
    startTime += intervalSeconds
  ) {
    const refBlock = resampleAt(
      reference,
      sampleRate,
      startTime,
      blockSeconds,
      analysisSampleRate,
    );
    const targetBlock = resampleAt(
      target,
      sampleRate,
      startTime - maxOffsetSeconds,
      blockSeconds + maxOffsetSeconds * 2,
      analysisSampleRate,
    );
    const measured = fftBlockOffset(
      refBlock,
      targetBlock,
      Math.round(maxOffsetSeconds * analysisSampleRate),
      analysisSampleRate,
    );
    observations.push({
      timeSeconds: startTime + blockSeconds / 2,
      ...measured,
    });
  }
  return fitMulticamDriftModel(observations);
}
