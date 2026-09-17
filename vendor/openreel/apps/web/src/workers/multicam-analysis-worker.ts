/// <reference lib="webworker" />

import {
  analyzeMulticamDrift,
  type MulticamDriftAnalysisOptions,
} from "@openreel/core";

interface DriftRequest {
  requestId: string;
  type: "drift";
  reference: Float32Array;
  target: Float32Array;
  sampleRate: number;
  options?: MulticamDriftAnalysisOptions;
}

self.onmessage = (event: MessageEvent<DriftRequest>) => {
  const { requestId, reference, target, sampleRate, options } = event.data;
  try {
    self.postMessage({
      requestId,
      type: "result",
      model: analyzeMulticamDrift(reference, target, sampleRate, options),
    });
  } catch (error) {
    self.postMessage({
      requestId,
      type: "error",
      message: error instanceof Error ? error.message : "Multicam sync failed",
    });
  }
};

export {};
