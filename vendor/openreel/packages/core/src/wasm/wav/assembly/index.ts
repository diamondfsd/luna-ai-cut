export function encodeWav16Mono(
  samples: Float32Array,
  output: Uint8Array,
  dataOffset: i32,
): void {
  const numSamples = samples.length;

  for (let i = 0; i < numSamples; i++) {
    let sample = unchecked(samples[i]);
    sample = sample < -1.0 ? -1.0 : sample > 1.0 ? 1.0 : sample;

    const intSample: i16 = <i16>(sample * 32767.0);
    const offset = dataOffset + i * 2;

    unchecked((output[offset] = <u8>(intSample & 0xff)));
    unchecked((output[offset + 1] = <u8>((intSample >> 8) & 0xff)));
  }
}

export function encodeWav16Stereo(
  left: Float32Array,
  right: Float32Array,
  output: Uint8Array,
  dataOffset: i32,
): void {
  const numSamples = left.length;

  for (let i = 0; i < numSamples; i++) {
    let leftSample = unchecked(left[i]);
    let rightSample = unchecked(right[i]);

    leftSample = leftSample < -1.0 ? -1.0 : leftSample > 1.0 ? 1.0 : leftSample;
    rightSample =
      rightSample < -1.0 ? -1.0 : rightSample > 1.0 ? 1.0 : rightSample;

    const leftInt: i16 = <i16>(leftSample * 32767.0);
    const rightInt: i16 = <i16>(rightSample * 32767.0);
    const offset = dataOffset + i * 4;

    unchecked((output[offset] = <u8>(leftInt & 0xff)));
    unchecked((output[offset + 1] = <u8>((leftInt >> 8) & 0xff)));
    unchecked((output[offset + 2] = <u8>(rightInt & 0xff)));
    unchecked((output[offset + 3] = <u8>((rightInt >> 8) & 0xff)));
  }
}

export function encodeWav24Stereo(
  left: Float32Array,
  right: Float32Array,
  output: Uint8Array,
  dataOffset: i32,
): void {
  const numSamples = left.length;
  const maxVal: f32 = 8388607.0;

  for (let i = 0; i < numSamples; i++) {
    let leftSample = unchecked(left[i]);
    let rightSample = unchecked(right[i]);

    leftSample = leftSample < -1.0 ? -1.0 : leftSample > 1.0 ? 1.0 : leftSample;
    rightSample =
      rightSample < -1.0 ? -1.0 : rightSample > 1.0 ? 1.0 : rightSample;

    const leftInt: i32 = <i32>(leftSample * maxVal);
    const rightInt: i32 = <i32>(rightSample * maxVal);
    const offset = dataOffset + i * 6;

    unchecked((output[offset] = <u8>(leftInt & 0xff)));
    unchecked((output[offset + 1] = <u8>((leftInt >> 8) & 0xff)));
    unchecked((output[offset + 2] = <u8>((leftInt >> 16) & 0xff)));
    unchecked((output[offset + 3] = <u8>(rightInt & 0xff)));
    unchecked((output[offset + 4] = <u8>((rightInt >> 8) & 0xff)));
    unchecked((output[offset + 5] = <u8>((rightInt >> 16) & 0xff)));
  }
}

export function writeWavHeader(
  output: Uint8Array,
  numChannels: i32,
  sampleRate: i32,
  bitsPerSample: i32,
  numSamples: i32,
): void {
  const bytesPerSample = bitsPerSample >> 3;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const fileSize = 36 + dataSize;

  unchecked((output[0] = 0x52));
  unchecked((output[1] = 0x49));
  unchecked((output[2] = 0x46));
  unchecked((output[3] = 0x46));

  unchecked((output[4] = <u8>(fileSize & 0xff)));
  unchecked((output[5] = <u8>((fileSize >> 8) & 0xff)));
  unchecked((output[6] = <u8>((fileSize >> 16) & 0xff)));
  unchecked((output[7] = <u8>((fileSize >> 24) & 0xff)));

  unchecked((output[8] = 0x57));
  unchecked((output[9] = 0x41));
  unchecked((output[10] = 0x56));
  unchecked((output[11] = 0x45));

  unchecked((output[12] = 0x66));
  unchecked((output[13] = 0x6d));
  unchecked((output[14] = 0x74));
  unchecked((output[15] = 0x20));

  unchecked((output[16] = 16));
  unchecked((output[17] = 0));
  unchecked((output[18] = 0));
  unchecked((output[19] = 0));

  unchecked((output[20] = 1));
  unchecked((output[21] = 0));

  unchecked((output[22] = <u8>(numChannels & 0xff)));
  unchecked((output[23] = <u8>((numChannels >> 8) & 0xff)));

  unchecked((output[24] = <u8>(sampleRate & 0xff)));
  unchecked((output[25] = <u8>((sampleRate >> 8) & 0xff)));
  unchecked((output[26] = <u8>((sampleRate >> 16) & 0xff)));
  unchecked((output[27] = <u8>((sampleRate >> 24) & 0xff)));

  unchecked((output[28] = <u8>(byteRate & 0xff)));
  unchecked((output[29] = <u8>((byteRate >> 8) & 0xff)));
  unchecked((output[30] = <u8>((byteRate >> 16) & 0xff)));
  unchecked((output[31] = <u8>((byteRate >> 24) & 0xff)));

  unchecked((output[32] = <u8>(blockAlign & 0xff)));
  unchecked((output[33] = <u8>((blockAlign >> 8) & 0xff)));

  unchecked((output[34] = <u8>(bitsPerSample & 0xff)));
  unchecked((output[35] = <u8>((bitsPerSample >> 8) & 0xff)));

  unchecked((output[36] = 0x64));
  unchecked((output[37] = 0x61));
  unchecked((output[38] = 0x74));
  unchecked((output[39] = 0x61));

  unchecked((output[40] = <u8>(dataSize & 0xff)));
  unchecked((output[41] = <u8>((dataSize >> 8) & 0xff)));
  unchecked((output[42] = <u8>((dataSize >> 16) & 0xff)));
  unchecked((output[43] = <u8>((dataSize >> 24) & 0xff)));
}

export function allocateU8(length: i32): Uint8Array {
  return new Uint8Array(length);
}

export function allocateF32(length: i32): Float32Array {
  return new Float32Array(length);
}
