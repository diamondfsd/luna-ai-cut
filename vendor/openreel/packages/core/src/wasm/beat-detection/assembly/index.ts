export function computeRMSEnergies(
  samples: Float32Array,
  windowSize: i32,
  hopSize: i32,
  energies: Float32Array,
): void {
  const numSamples = samples.length;
  const numFrames = energies.length;
  const invWindow: f32 = 1.0 / <f32>windowSize;

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;
    let sum: f32 = 0.0;

    let i = 0;
    const end = windowSize - 4;
    for (; i < end; i += 4) {
      const idx = start + i;
      if (idx + 3 < numSamples) {
        const s0 = unchecked(samples[idx]);
        const s1 = unchecked(samples[idx + 1]);
        const s2 = unchecked(samples[idx + 2]);
        const s3 = unchecked(samples[idx + 3]);
        sum += s0 * s0 + s1 * s1 + s2 * s2 + s3 * s3;
      }
    }

    for (; i < windowSize; i++) {
      const idx = start + i;
      if (idx < numSamples) {
        const s = unchecked(samples[idx]);
        sum += s * s;
      }
    }

    unchecked((energies[frame] = Mathf.sqrt(sum * invWindow)));
  }
}

export function smoothArray(
  input: Float32Array,
  output: Float32Array,
  windowSize: i32,
): void {
  const len = input.length;
  const halfWindow = windowSize >> 1;
  const invWindow: f32 = 1.0 / <f32>windowSize;

  for (let i = 0; i < len; i++) {
    let sum: f32 = 0.0;
    const start = i - halfWindow;
    const end = i + halfWindow + 1;

    for (let j = start; j < end; j++) {
      const idx = j < 0 ? 0 : j >= len ? len - 1 : j;
      sum += unchecked(input[idx]);
    }

    unchecked((output[i] = sum * invWindow));
  }
}

function partition(arr: Float32Array, left: i32, right: i32): i32 {
  const pivot = unchecked(arr[right]);
  let i = left - 1;

  for (let j = left; j < right; j++) {
    if (unchecked(arr[j]) <= pivot) {
      i++;
      const temp = unchecked(arr[i]);
      unchecked((arr[i] = arr[j]));
      unchecked((arr[j] = temp));
    }
  }

  const temp = unchecked(arr[i + 1]);
  unchecked((arr[i + 1] = arr[right]));
  unchecked((arr[right] = temp));

  return i + 1;
}

function quickSelect(arr: Float32Array, left: i32, right: i32, k: i32): f32 {
  if (left === right) {
    return unchecked(arr[left]);
  }

  const pivotIndex = partition(arr, left, right);

  if (k === pivotIndex) {
    return unchecked(arr[k]);
  } else if (k < pivotIndex) {
    return quickSelect(arr, left, pivotIndex - 1, k);
  } else {
    return quickSelect(arr, pivotIndex + 1, right, k);
  }
}

export function calculateMedian(arr: Float32Array): f32 {
  const len = arr.length;
  if (len === 0) return 0.0;

  const copy = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    unchecked((copy[i] = arr[i]));
  }

  const mid = len >> 1;
  if ((len & 1) === 1) {
    return quickSelect(copy, 0, len - 1, mid);
  } else {
    const lower = quickSelect(copy, 0, len - 1, mid - 1);
    const upper = quickSelect(copy, 0, len - 1, mid);
    return (lower + upper) * 0.5;
  }
}

export function findPeaks(
  energies: Float32Array,
  threshold: f32,
  minDistance: i32,
  peaks: Int32Array,
): i32 {
  const len = energies.length;
  let peakCount: i32 = 0;
  let lastPeak: i32 = -minDistance;

  for (let i = 1; i < len - 1; i++) {
    const curr = unchecked(energies[i]);
    const prev = unchecked(energies[i - 1]);
    const next = unchecked(energies[i + 1]);

    if (curr > prev && curr > next && curr > threshold) {
      if (i - lastPeak >= minDistance) {
        if (peakCount < peaks.length) {
          unchecked((peaks[peakCount] = i));
          peakCount++;
          lastPeak = i;
        }
      }
    }
  }

  return peakCount;
}

export function calculateMean(arr: Float32Array): f32 {
  const len = arr.length;
  if (len === 0) return 0.0;

  let sum: f32 = 0.0;
  for (let i = 0; i < len; i++) {
    sum += unchecked(arr[i]);
  }
  return sum / <f32>len;
}

export function calculateStdDev(arr: Float32Array, mean: f32): f32 {
  const len = arr.length;
  if (len === 0) return 0.0;

  let sumSq: f32 = 0.0;
  for (let i = 0; i < len; i++) {
    const diff = unchecked(arr[i]) - mean;
    sumSq += diff * diff;
  }
  return Mathf.sqrt(sumSq / <f32>len);
}

export function allocateF32(length: i32): Float32Array {
  return new Float32Array(length);
}

export function allocateI32(length: i32): Int32Array {
  return new Int32Array(length);
}
