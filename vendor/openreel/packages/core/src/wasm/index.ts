import { initWasmFFT, isWasmFFTAvailable } from "./fft";
import { initWasmWav, isWasmWavAvailable } from "./wav";
import { initWasmBeatDetection, isWasmBeatDetectionAvailable } from "./beat-detection";

export { WasmFFT, getWasmFFT, preloadWasmFFT, initWasmFFT, isWasmFFTAvailable } from "./fft";
export { WavEncoder, getWavEncoder, preloadWasmWav, initWasmWav, isWasmWavAvailable } from "./wav";
export {
  BeatDetectionProcessor,
  getBeatDetectionProcessor,
  preloadWasmBeatDetection,
  initWasmBeatDetection,
  isWasmBeatDetectionAvailable,
} from "./beat-detection";

export type WasmModuleStatus = {
  fft: "loading" | "ready" | "unavailable";
  wav: "loading" | "ready" | "unavailable";
  beatDetection: "loading" | "ready" | "unavailable";
};

export function getWasmModuleStatus(): WasmModuleStatus {
  return {
    fft: isWasmFFTAvailable() ? "ready" : "unavailable",
    wav: isWasmWavAvailable() ? "ready" : "unavailable",
    beatDetection: isWasmBeatDetectionAvailable() ? "ready" : "unavailable",
  };
}

export async function preloadAllWasmModules(): Promise<WasmModuleStatus> {
  const results = await Promise.allSettled([
    initWasmFFT(),
    initWasmWav(),
    initWasmBeatDetection(),
  ]);

  return {
    fft: results[0].status === "fulfilled" && results[0].value ? "ready" : "unavailable",
    wav: results[1].status === "fulfilled" && results[1].value ? "ready" : "unavailable",
    beatDetection: results[2].status === "fulfilled" && results[2].value ? "ready" : "unavailable",
  };
}

export function isWebAssemblySupported(): boolean {
  return typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiate === "function";
}
