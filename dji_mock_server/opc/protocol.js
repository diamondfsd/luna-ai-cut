import { Buffer } from "node:buffer";

export const FLAG_REQUEST = 0x40;
export const FLAG_RESPONSE = 0xc0;
export const FLAG_NOTIFY = 0x00;
export const FLAG_ACK_80 = 0x80;

export const PKT_HANDSHAKE = 0x00;
export const PKT_TELEMETRY = 0x01;
export const PKT_VIDEO = 0x02;
export const PKT_ACKED_DATA = 0x03;
export const PKT_ACK = 0x04;
export const PKT_COMMAND = 0x05;

export const SENDER_APP = 0x02;
export const RX_CAMERA = 0x01;
export const RX_WIFI = 0x07;
export const RX_GIMBAL = 0x04;
export const RX_SESSION = 0xf0;

export class ProtocolError extends Error {
  constructor(message, code = "PROTOCOL_ERROR") {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}

export function u16le(buffer, offset = 0) {
  return buffer.readUInt16LE(offset);
}

export function u32le(buffer, offset = 0) {
  return buffer.readUInt32LE(offset);
}

export function i16le(buffer, offset = 0) {
  return buffer.readInt16LE(offset);
}

export function putU16le(value) {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value & 0xffff);
  return out;
}

export function putU32le(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
}

export function putI16le(value) {
  const out = Buffer.alloc(2);
  out.writeInt16LE(Math.max(-32768, Math.min(32767, value)));
  return out;
}

export function crc8(input) {
  const data = Buffer.from(input);
  let value = 0x77;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (value >>> 1) ^ 0x8c : value >>> 1;
    }
  }
  return value;
}

export function crc16(input) {
  const data = Buffer.from(input);
  let value = 0x3692;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (value >>> 1) ^ 0x8408 : value >>> 1;
    }
  }
  return value;
}

export function encodeDuml({
  sender,
  receiver,
  seq,
  flags,
  cmdSet,
  cmdId,
  payload = Buffer.alloc(0),
}) {
  const body = Buffer.from(payload);
  const total = 13 + body.length;
  if (total > 0x3ff) throw new ProtocolError(`DUML frame is too large: ${total}`, "FRAME_TOO_LARGE");
  const out = Buffer.alloc(total);
  out[0] = 0x55;
  out[1] = total & 0xff;
  out[2] = 0x04 | ((total >>> 8) & 0x03);
  out[3] = crc8(out.subarray(0, 3));
  out[4] = sender & 0xff;
  out[5] = receiver & 0xff;
  out.writeUInt16LE(seq & 0xffff, 6);
  out[8] = flags & 0xff;
  out[9] = cmdSet & 0xff;
  out[10] = cmdId & 0xff;
  body.copy(out, 11);
  out.writeUInt16LE(crc16(out.subarray(0, total - 2)), total - 2);
  return out;
}

export function decodeDuml(data, offset = 0) {
  const buffer = Buffer.from(data);
  if (offset < 0 || offset > buffer.length) return { status: "invalid", reason: "offset out of range" };
  if (buffer.length - offset < 4) return { status: "incomplete" };
  if (buffer[offset] !== 0x55) return { status: "invalid", reason: "missing DUML SOF" };
  const total = buffer[offset + 1] | ((buffer[offset + 2] & 0x03) << 8);
  if ((buffer[offset + 2] >>> 2) !== 1) return { status: "invalid", reason: "unsupported DUML version" };
  if (total < 13) return { status: "invalid", reason: "DUML length is below 13" };
  if (buffer.length - offset < total) return { status: "incomplete", total };
  const frame = buffer.subarray(offset, offset + total);
  if (crc8(frame.subarray(0, 3)) !== frame[3]) return { status: "invalid", reason: "DUML header CRC mismatch" };
  if (crc16(frame.subarray(0, total - 2)) !== frame.readUInt16LE(total - 2)) {
    return { status: "invalid", reason: "DUML payload CRC mismatch" };
  }
  return {
    status: "ok",
    consumed: total,
    frame: {
      sender: frame[4],
      receiver: frame[5],
      seq: frame.readUInt16LE(6),
      flags: frame[8],
      cmdSet: frame[9],
      cmdId: frame[10],
      payload: Buffer.from(frame.subarray(11, total - 2)),
    },
  };
}

export function scanFrames(data) {
  const buffer = Buffer.from(data);
  const frames = [];
  for (let offset = 0; offset + 13 <= buffer.length; offset += 1) {
    if (buffer[offset] !== 0x55) continue;
    const decoded = decodeDuml(buffer, offset);
    if (decoded.status === "ok") {
      frames.push(decoded.frame);
      offset += decoded.consumed - 1;
    }
  }
  return frames;
}

export class DumlStreamDecoder {
  constructor(maxBuffer = 64 * 1024) {
    this.maxBuffer = maxBuffer;
    this.buffer = Buffer.alloc(0);
    this.invalidFrames = 0;
    this.lastError = null;
  }

  push(chunk) {
    const incoming = Buffer.from(chunk);
    this.buffer = Buffer.concat([this.buffer, incoming]);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer = this.buffer.subarray(this.buffer.length - this.maxBuffer);
    }
    const frames = [];
    while (this.buffer.length >= 4) {
      const sof = this.buffer.indexOf(0x55);
      if (sof < 0) {
        this.buffer = Buffer.alloc(0);
        break;
      }
      if (sof > 0) this.buffer = this.buffer.subarray(sof);
      const decoded = decodeDuml(this.buffer);
      if (decoded.status === "incomplete") break;
      if (decoded.status !== "ok") {
        this.invalidFrames += 1;
        this.lastError = decoded.reason || "invalid DUML frame";
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      frames.push(decoded.frame);
      this.buffer = this.buffer.subarray(decoded.consumed);
    }
    return frames;
  }
}

export function transportHeader({ pktType, payloadLength, sessionId, seq }) {
  const total = 8 + payloadLength;
  if (total > 0x3fff) throw new ProtocolError(`transport packet is too large: ${total}`, "PACKET_TOO_LARGE");
  const out = Buffer.alloc(8);
  out.writeUInt16LE(0x8000 | total, 0);
  out.writeUInt16LE(sessionId & 0xffff, 2);
  out.writeUInt16LE(seq & 0xffff, 4);
  out[6] = pktType & 0xff;
  let xor = 0;
  for (let index = 0; index < 7; index += 1) xor ^= out[index];
  out[7] = xor;
  return out;
}

export function decodeTransport(data) {
  const buffer = Buffer.from(data);
  if (buffer.length < 8) throw new ProtocolError("transport packet is shorter than 8 bytes", "PACKET_SHORT");
  const encodedLength = buffer.readUInt16LE(0);
  if ((encodedLength & 0x8000) === 0) throw new ProtocolError("transport marker bit is missing", "PACKET_MARKER");
  const total = encodedLength & 0x3fff;
  if (total < 8) throw new ProtocolError("transport length is below 8", "PACKET_LENGTH");
  if (total !== buffer.length) throw new ProtocolError(`transport length ${total} != datagram ${buffer.length}`, "PACKET_LENGTH");
  let xor = 0;
  for (let index = 0; index < 7; index += 1) xor ^= buffer[index];
  if (xor !== buffer[7]) throw new ProtocolError("transport header XOR mismatch", "PACKET_XOR");
  return {
    total,
    sessionId: buffer.readUInt16LE(2),
    seq: buffer.readUInt16LE(4),
    pktType: buffer[6],
    payload: Buffer.from(buffer.subarray(8)),
  };
}

export function routingHeader(seq, cmdCounter, drone = false) {
  const out = Buffer.alloc(12);
  out.writeUInt16LE((seq - 8) & 0xffff, 0);
  out.writeUInt16LE(seq & 0xffff, 2);
  out[8] = cmdCounter & 0xff;
  out[9] = 0x01;
  out[10] = drone ? 0x60 : 0x00;
  return out;
}

export function wrapCommand(frame, { sessionId, transportSeq, cmdCounter }) {
  const duml = encodeDuml(frame);
  const routing = routingHeader(transportSeq, cmdCounter);
  return Buffer.concat([
    transportHeader({ pktType: PKT_COMMAND, payloadLength: routing.length + duml.length, sessionId, seq: transportSeq }),
    routing,
    duml,
  ]);
}

export function handshakePayload(baseSeq) {
  const out = Buffer.from([
    0x00, 0x00, 0x64, 0x00, 0x64, 0x00, 0xc0, 0x05, 0x14, 0x00, 0x00, 0x64, 0x00, 0x00,
    0x01, 0x90, 0x01, 0xc0, 0x05, 0x14, 0x00, 0x00, 0x64, 0x00, 0x14, 0x00, 0x64, 0x00,
    0xc0, 0x05, 0x14, 0x00, 0x00, 0x64, 0x00, 0x01, 0x01, 0x04, 0x01, 0x02,
  ]);
  out.writeUInt16LE(baseSeq & 0xffff, 0);
  return out;
}

export function handshakeDatagram({ sessionId, seq, baseSeq }) {
  const payload = handshakePayload(baseSeq);
  return Buffer.concat([
    transportHeader({ pktType: PKT_HANDSHAKE, payloadLength: payload.length, sessionId, seq }),
    payload,
  ]);
}

function ackGroup(value) {
  const out = Buffer.alloc(8);
  out.writeUInt16LE(value & 0xffff, 0);
  out.writeUInt16LE(value & 0xffff, 2);
  return out;
}

export function ackPayload(video, ackedData, extra) {
  return Buffer.concat([ackGroup(video), ackGroup(ackedData), ackGroup(extra), Buffer.alloc(2)]);
}

export function ackDatagram({ sessionId, video, ackedData, extra }) {
  const payload = ackPayload(video, ackedData, extra);
  return Buffer.concat([
    transportHeader({ pktType: PKT_ACK, payloadLength: payload.length, sessionId, seq: 0 }),
    payload,
  ]);
}

export function dataDatagram({ pktType = PKT_ACKED_DATA, sessionId, seq, payload }) {
  const body = Buffer.from(payload);
  return Buffer.concat([
    transportHeader({ pktType, payloadLength: body.length, sessionId, seq }),
    body,
  ]);
}

export function responseFrame(request, payload, flags = FLAG_RESPONSE, sender = 0x01) {
  return {
    sender,
    receiver: request.sender,
    seq: request.seq,
    flags,
    cmdSet: request.cmdSet,
    cmdId: request.cmdId,
    payload: Buffer.from(payload),
  };
}

export function packString(value) {
  const data = Buffer.from(value, "utf8");
  if (data.length > 255) throw new ProtocolError("packed string is longer than 255 bytes", "STRING_TOO_LONG");
  return Buffer.concat([Buffer.from([data.length]), data]);
}

export function parsePackedString(data, offset = 0) {
  if (offset >= data.length) throw new ProtocolError("packed string is missing length", "STRING_MISSING");
  const length = data[offset];
  if (offset + 1 + length > data.length) throw new ProtocolError("packed string is truncated", "STRING_TRUNCATED");
  return { value: data.subarray(offset + 1, offset + 1 + length).toString("utf8"), next: offset + 1 + length };
}

export function parseSubscription(data) {
  if (data.length < 17 || data[0] !== 0x02 || data[1] !== 0x02) {
    throw new ProtocolError("subscription verb must be 02 02", "SUBSCRIPTION_VERB");
  }
  const subId = data.readUInt32LE(4);
  const innerLength = data.readUInt16LE(11);
  const nameLength = data.readUInt16LE(13);
  const nameStart = 15;
  const tailStart = nameStart + nameLength;
  if (
    data[2] !== 0 || data[3] !== 0 || data.subarray(8, 11).some((value) => value !== 0)
    || nameLength < 1 || nameLength > 79 || innerLength !== nameLength + 6
    || tailStart + 4 !== data.length || data.subarray(tailStart).some((value) => value !== 0)
  ) {
    throw new ProtocolError("subscription payload has invalid lengths", "SUBSCRIPTION_LENGTH");
  }
  const name = data.subarray(nameStart, nameStart + nameLength).toString("utf8");
  if (!/^[\x20-\x7e]+$/.test(name)) throw new ProtocolError("subscription key is not ASCII", "SUBSCRIPTION_NAME");
  return { name, subId };
}

export function parseParam(data) {
  if (data.length < 4) throw new ProtocolError("param payload is shorter than 4 bytes", "PARAM_SHORT");
  const verb = data[0];
  if (verb === 0x00 && data[1] === 0x01 && data.length === 4) {
    return { kind: "get", pid: data.readUInt16LE(2), value: Buffer.alloc(0) };
  }
  if (verb === 0x01 && data[1] === 0x01 && data.length >= 5) {
    const length = data[4];
    if (data.length !== 5 + length) throw new ProtocolError("param SET length mismatch", "PARAM_LENGTH");
    return { kind: "set", pid: data.readUInt16LE(2), value: Buffer.from(data.subarray(5)) };
  }
  throw new ProtocolError("unknown param GET/SET verb", "PARAM_VERB");
}

export function paramGetReply(pid, value) {
  const body = Buffer.from(value);
  return Buffer.concat([Buffer.from([0x00, 0x00, 0x01]), putU16le(pid), Buffer.from([body.length]), body]);
}

export function packSubscribePush(name, value, idx = 0) {
  const nameBytes = Buffer.from(name, "utf8");
  const body = Buffer.concat([
    Buffer.from([nameBytes.length & 0xff, (nameBytes.length >>> 8) & 0xff]),
    nameBytes,
    Buffer.alloc(6),
    Buffer.from([value.length & 0xff, (value.length >>> 8) & 0xff]),
    Buffer.from(value),
  ]);
  return Buffer.concat([
    Buffer.from([0x02, 0x06, 0x00, 0x00]),
    putU32le(idx),
    Buffer.alloc(3),
    putU16le(body.length),
    body,
  ]);
}

export function hex(buffer) {
  return Buffer.from(buffer).toString("hex").replace(/(..)(?=.)/g, "$1 ").trim();
}
