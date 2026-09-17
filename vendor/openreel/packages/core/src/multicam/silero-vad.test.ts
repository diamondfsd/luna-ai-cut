import { describe, expect, it, vi } from "vitest";
import {
  analyzeSileroVad,
  SILERO_VAD_CHUNK_SAMPLES,
  SILERO_VAD_CONTEXT_SAMPLES,
} from "./silero-vad";

class TestTensor {
  constructor(
    public type: string,
    public data: Float32Array | BigInt64Array,
    public dimensions: readonly number[],
  ) {}
}

describe("Silero VAD", () => {
  it("feeds context, recurrent state, and 16 kHz chunks to ONNX", async () => {
    let callCount = 0;
    const run = vi.fn(async (_feeds: Record<string, TestTensor>) => {
      callCount++;
      return {
        output: { data: new Float32Array([callCount / 10]) },
        stateN: { data: new Float32Array(256).fill(callCount) },
      };
    });
    const runtime = {
      Tensor: TestTensor,
      InferenceSession: { create: vi.fn() },
    };
    const progress = vi.fn();
    const result = await analyzeSileroVad(
      new Float32Array(SILERO_VAD_CHUNK_SAMPLES * 2).fill(0.25),
      16_000,
      { runtime, session: { run }, onProgress: progress },
    );

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0].input.dimensions).toEqual([
      1,
      SILERO_VAD_CHUNK_SAMPLES + SILERO_VAD_CONTEXT_SAMPLES,
    ]);
    expect(run.mock.calls[1]?.[0].state.data[0]).toBe(1);
    expect(result.windowMs).toBe(32);
    expect(result.probabilities[0]).toBeCloseTo(0.1);
    expect(result.probabilities[1]).toBeCloseTo(0.2);
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });

  it("resamples input audio to the model sample rate", async () => {
    const run = vi.fn(async () => ({
      output: { data: new Float32Array([0.75]) },
      stateN: { data: new Float32Array(256) },
    }));
    const result = await analyzeSileroVad(new Float32Array(8_000), 8_000, {
      runtime: {
        Tensor: TestTensor,
        InferenceSession: { create: vi.fn() },
      },
      session: { run },
    });

    expect(run).toHaveBeenCalledTimes(Math.ceil(16_000 / 512));
    expect(result.probabilities[0]).toBeCloseTo(0.75);
  });
});
