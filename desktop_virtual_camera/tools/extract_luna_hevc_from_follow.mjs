#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const input = resolve(process.argv[2] ?? 'protocol_analysis/artifacts/luna-exposure-focus-tracking-follow-0.txt');
const output = resolve(process.argv[3] ?? 'desktop_virtual_camera/tools/recovered/luna-preview.hevc');
const text = await readFile(input, 'utf8');

// tshark follow output separates the two TCP directions by indentation. The
// unindented direction is the camera-to-client stream for this capture.
const directions = [[], []];
for (const line of text.split('\n')) {
  const direction = line.startsWith('\t') ? 1 : 0;
  if (!/^\s*[0-9a-f]{8}\s+/i.test(line)) continue;
  const rest = line.replace(/^\s*[0-9a-f]{8}\s+/i, '');
  const tokens = rest.trim().split(/\s+/);
  for (const token of tokens.slice(0, 16)) {
    if (!/^[0-9a-f]{2}$/i.test(token)) break;
    directions[direction].push(Number.parseInt(token, 16));
  }
}

const magic = Buffer.from('UCD2', 'ascii');
function extract(stream) {
  let offset = 0;
  let mediaFrames = 0;
  let videoFrames = 0;
  let mediaBytes = 0;
  const hevc = [];
  while (offset + 16 <= stream.length) {
    const start = stream.indexOf(magic, offset);
    if (start < 0 || start + 12 > stream.length) break;
    const type = stream[start + 6];
    const rawLength = stream.readUInt32LE(start + 8);
    const totalLength = 12 + rawLength + 4;
    if (rawLength < 9 || totalLength > 32 * 1024 * 1024 || start + totalLength > stream.length) {
      offset = start + 4;
      continue;
    }
    const payload = stream.subarray(start + 12, start + 12 + rawLength);
    if (type === 0x01) {
      mediaFrames += 1;
      if (payload[0] === 0x20 && payload.length > 9) {
        const data = payload.subarray(9);
        videoFrames += 1;
        mediaBytes += data.length;
        hevc.push(data);
      }
    }
    offset = start + totalLength;
  }
  return { mediaFrames, videoFrames, mediaBytes, hevc: Buffer.concat(hevc), parsedBytes: stream.length };
}

const candidates = directions.map((bytes, direction) => ({ direction, ...extract(Buffer.from(bytes)) }));
const selected = candidates.sort((a, b) => b.videoFrames - a.videoFrames)[0];
await writeFile(output, selected.hevc);
console.log(JSON.stringify({ input, output, ...selected, hevc: undefined, hevcBytes: selected.mediaBytes, candidates: candidates.map(({ hevc: _hevc, ...candidate }) => candidate) }, null, 2));
