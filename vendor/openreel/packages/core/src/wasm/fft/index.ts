import { FFT as JsFFT } from "../../audio/fft";

export type WasmFFTExports = {
  init(size: number): void;
  getSize(): number;
  forward(input: Float32Array, real: Float32Array, imag: Float32Array): void;
  inverse(real: Float32Array, imag: Float32Array, output: Float32Array): void;
  getMagnitude(
    real: Float32Array,
    imag: Float32Array,
    magnitude: Float32Array,
  ): void;
  getMagnitudeAndPhase(
    real: Float32Array,
    imag: Float32Array,
    magnitudes: Float32Array,
    phases: Float32Array,
  ): void;
  fromMagnitudeAndPhase(
    magnitudes: Float32Array,
    phases: Float32Array,
    real: Float32Array,
    imag: Float32Array,
  ): void;
  applyHannWindow(input: Float32Array, output: Float32Array): void;
  allocateF32(length: number): Float32Array;
  allocateU32(length: number): Uint32Array;
  memory: WebAssembly.Memory;
};

let wasmModule: WasmFFTExports | null = null;
let loadPromise: Promise<WasmFFTExports | null> | null = null;
let currentWasmSize = 0;

async function loadWasmModule(): Promise<WasmFFTExports | null> {
  if (typeof WebAssembly === "undefined") {
    return null;
  }

  try {
    const wasmUrl = new URL("./build/fft.wasm", import.meta.url);
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      return null;
    }

    const wasmBytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(wasmBytes, {
      env: {
        abort: () => {
          throw new Error("WASM abort");
        },
      },
    });

    return instance.exports as unknown as WasmFFTExports;
  } catch {
    return null;
  }
}

export async function initWasmFFT(): Promise<boolean> {
  if (wasmModule) {
    return true;
  }

  if (!loadPromise) {
    loadPromise = loadWasmModule();
  }

  wasmModule = await loadPromise;
  return wasmModule !== null;
}

export function isWasmFFTAvailable(): boolean {
  return wasmModule !== null;
}

export class WasmFFT {
  private readonly size: number;
  private readonly jsFFT: JsFFT;
  private useWasm: boolean;

  private real: Float32Array;
  private imag: Float32Array;

  constructor(size: number) {
    if (size <= 0 || (size & (size - 1)) !== 0) {
      throw new Error("FFT size must be a power of 2");
    }

    this.size = size;
    this.jsFFT = new JsFFT(size);
    this.useWasm = false;
    this.real = new Float32Array(size);
    this.imag = new Float32Array(size);

    if (wasmModule && currentWasmSize !== size) {
      wasmModule.init(size);
      currentWasmSize = size;
      this.useWasm = true;
    } else if (wasmModule && currentWasmSize === size) {
      this.useWasm = true;
    }
  }

  async ensureWasm(): Promise<boolean> {
    if (this.useWasm) {
      return true;
    }

    const available = await initWasmFFT();
    if (available && wasmModule) {
      if (currentWasmSize !== this.size) {
        wasmModule.init(this.size);
        currentWasmSize = this.size;
      }
      this.useWasm = true;
    }
    return this.useWasm;
  }

  getSize(): number {
    return this.size;
  }

  private ensureWasmSize(): void {
    if (this.useWasm && wasmModule && currentWasmSize !== this.size) {
      wasmModule.init(this.size);
      currentWasmSize = this.size;
    }
  }

  forward(input: Float32Array): { real: Float32Array; imag: Float32Array } {
    if (this.useWasm && wasmModule) {
      this.ensureWasmSize();
      wasmModule.forward(input, this.real, this.imag);
      return { real: this.real.slice(), imag: this.imag.slice() };
    }
    return this.jsFFT.forward(input);
  }

  inverse(real: Float32Array, imag: Float32Array): Float32Array {
    if (this.useWasm && wasmModule) {
      this.ensureWasmSize();
      const output = new Float32Array(this.size);
      wasmModule.inverse(real, imag, output);
      return output;
    }
    return this.jsFFT.inverse(real, imag);
  }

  getMagnitude(real: Float32Array, imag: Float32Array): Float32Array {
    if (this.useWasm && wasmModule) {
      this.ensureWasmSize();
      const magnitude = new Float32Array(this.size / 2);
      wasmModule.getMagnitude(real, imag, magnitude);
      return magnitude;
    }
    return this.jsFFT.getMagnitude(real, imag);
  }

  getPower(real: Float32Array, imag: Float32Array): Float32Array {
    return this.jsFFT.getPower(real, imag);
  }

  getMagnitudeAndPhase(
    real: Float32Array,
    imag: Float32Array,
  ): { magnitudes: Float32Array; phases: Float32Array } {
    if (this.useWasm && wasmModule) {
      this.ensureWasmSize();
      const magnitudes = new Float32Array(this.size / 2);
      const phases = new Float32Array(this.size / 2);
      wasmModule.getMagnitudeAndPhase(real, imag, magnitudes, phases);
      return { magnitudes, phases };
    }
    return this.jsFFT.getMagnitudeAndPhase(real, imag);
  }

  fromMagnitudeAndPhase(
    magnitudes: Float32Array,
    phases: Float32Array,
  ): { real: Float32Array; imag: Float32Array } {
    if (this.useWasm && wasmModule) {
      this.ensureWasmSize();
      const real = new Float32Array(this.size);
      const imag = new Float32Array(this.size);
      wasmModule.fromMagnitudeAndPhase(magnitudes, phases, real, imag);
      return { real, imag };
    }
    return this.jsFFT.fromMagnitudeAndPhase(magnitudes, phases);
  }

  applyHannWindow(data: Float32Array): Float32Array {
    if (this.useWasm && wasmModule) {
      this.ensureWasmSize();
      const output = new Float32Array(data.length);
      wasmModule.applyHannWindow(data, output);
      return output;
    }
    return this.jsFFT.applyHannWindow(data);
  }

  applySynthesisWindow(data: Float32Array): Float32Array {
    return this.jsFFT.applySynthesisWindow(data);
  }
}

let cachedWasmFFT: WasmFFT | null = null;
let cachedWasmFFTSize = 0;

export function getWasmFFT(size: number): WasmFFT {
  if (cachedWasmFFT && cachedWasmFFTSize === size) {
    return cachedWasmFFT;
  }
  cachedWasmFFT = new WasmFFT(size);
  cachedWasmFFTSize = size;
  return cachedWasmFFT;
}

export async function preloadWasmFFT(size: number): Promise<WasmFFT> {
  const fft = getWasmFFT(size);
  await fft.ensureWasm();
  return fft;
}
