#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import dgram from "node:dgram";
import { MockCameraState, SUBSCRIPTION_KEYS, mediaManifest } from "./state.js";
import {
  DumlStreamDecoder,
  FLAG_ACK_80,
  FLAG_RESPONSE,
  PKT_ACK,
  PKT_ACKED_DATA,
  PKT_COMMAND,
  PKT_HANDSHAKE,
  PKT_TELEMETRY,
  PKT_VIDEO,
  ProtocolError,
  ackDatagram,
  dataDatagram,
  decodeDuml,
  decodeTransport,
  encodeDuml,
  handshakeDatagram,
  handshakePayload,
  hex,
  packString,
  packSubscribePush,
  paramGetReply,
  parseSubscription,
  responseFrame,
  scanFrames,
  transportHeader,
  u16le,
  u32le,
} from "./protocol.js";

const JPEG_1X1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z",
  "base64",
);

function parseArgs(argv) {
  const out = {
    host: "127.0.0.1",
    udpPort: 9004,
    tcpPort: 7001,
    httpPort: 18080,
    model: "pocket4pro",
    deviceName: null,
    ssid: null,
    wifiPassword: null,
    firmware: null,
    mediaRoot: null,
    videoSource: null,
    log: "human",
    responseDelayMs: 0,
    strictProtocol: true,
    presenceTimeoutMs: 5000,
    dropHandshake: false,
    dropAcks: false,
    dropVideo: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--host") out.host = argv[++index];
    else if (arg === "--udp-port") out.udpPort = numberArg(argv[++index], "udp-port");
    else if (arg === "--tcp-port") out.tcpPort = numberArg(argv[++index], "tcp-port");
    else if (arg === "--http-port") out.httpPort = numberArg(argv[++index], "http-port");
    else if (arg === "--model") out.model = argv[++index];
    else if (arg === "--device-name") out.deviceName = argv[++index];
    else if (arg === "--ssid") out.ssid = argv[++index];
    else if (arg === "--wifi-password") out.wifiPassword = argv[++index];
    else if (arg === "--firmware") out.firmware = argv[++index];
    else if (arg === "--media-root") out.mediaRoot = path.resolve(argv[++index]);
    else if (arg === "--video-source") out.videoSource = path.resolve(argv[++index]);
    else if (arg === "--json-log") out.log = "json";
    else if (arg === "--response-delay-ms") out.responseDelayMs = numberArg(argv[++index], "response-delay-ms");
    else if (arg === "--permissive") out.strictProtocol = false;
    else if (arg === "--presence-timeout-ms") out.presenceTimeoutMs = numberArg(argv[++index], "presence-timeout-ms");
    else if (arg === "--drop-handshake") out.dropHandshake = true;
    else if (arg === "--drop-acks") out.dropAcks = true;
    else if (arg === "--drop-video") out.dropVideo = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return out;
}

function numberArg(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) throw new Error(`--${name} must be an integer from 0 to 65535`);
  return parsed;
}

function usage() {
  return `OpenPocketCine Node camera mock

Usage:
  node server.js [options]

Options:
  --model pocket4pro|pocket4|pocket3|nano   Camera profile (default: pocket4pro)
  --device-name NAME                        Advertised camera name
  --ssid NAME                               Mock Wi-Fi SSID returned by 0x07/0x07
  --wifi-password VALUE                     Mock Wi-Fi password returned by 0x07/0x0e
  --firmware VERSION                        Firmware string used by diagnostics
  --host ADDRESS                            Bind address (default: 127.0.0.1)
  --udp-port PORT                           DUML datalink (default: 9004)
  --tcp-port PORT                           TCP pairing poke (default: 7001)
  --http-port PORT                          SoftAP /v2 server (default: 18080)
  --media-root DIR                          Serve virtual camera paths from DIR
  --video-source FILE                       Newline-delimited hex Annex-B AUs
  --response-delay-ms N                     Delay every mock response
  --presence-timeout-ms N                   Expire app presence after N ms (default: 5000)
  --permissive                              Keep payload checks but skip strict order/lifecycle checks
  --drop-handshake                          Do not answer UDP handshakes
  --drop-acks                               Do not answer command packets
  --drop-video                              Keep live enabled but suppress video
  --json-log                                Emit machine-readable JSON logs
  -h, --help                                Show this help

For a phone using the existing app, point its station/mock host at ADDRESS and use
HTTP port 80 (or a local port override in the app). The mock cannot emulate BLE/GATT.
`;
}

function opcode(frame) {
  return `${frame.cmdSet.toString(16).padStart(2, "0")}/${frame.cmdId.toString(16).padStart(2, "0")}`;
}

function isRequest(frame) {
  return frame.flags === 0x40 || frame.flags === 0x00 || frame.flags === 0x80;
}

function isNotification(frame) {
  return frame.flags === 0x00 && frame.cmdSet === 0x04 && [0x01, 0x14].includes(frame.cmdId);
}

function jsonSafeState(state) {
  return {
    model: state.profile.id,
    deviceName: state.deviceName,
    ssid: state.ssid,
    firmware: state.firmware,
    paired: state.paired,
    recording: state.recording,
    recordingDurationSeconds: state.recordingElapsedSeconds(),
    inPlayback: state.inPlayback,
    liveEnabled: state.liveEnabled,
    stationMode: state.stationMode,
    streaming: state.streaming,
    shootingMode: state.shootingMode,
    expoMode: state.expoMode,
    shutterDenom: state.shutterDenom,
    isoIndex: state.isoIndex,
    isoLimit: state.isoLimit,
    ev: state.ev,
    color: state.color,
    fov: state.fov,
    focusMode: state.focusMode,
    focusTrack: state.focusTrack,
    whiteBalance: { mode: state.wbMode, kelvin: state.wbKelvin, tint: state.wbTint },
    audioChannel: state.audioChannel,
    vocalBoost: state.vocalBoost,
    selfieFlip: state.selfieFlip,
    focusPoint: { x: state.focusX, y: state.focusY },
    tracking: state.tracking,
    zoomLens: state.zoomLens,
    gimbal: state.gimbal,
    subscriptions: [...state.subscriptions.entries()].map(([name, subId]) => ({ name, subId })),
    mediaCount: state.media.length,
  };
}

class MockCameraServer {
  constructor(options) {
    this.options = { ...parseArgs([]), ...(options || {}) };
    this.state = new MockCameraState({ model: this.options.model, deviceName: this.options.deviceName, ssid: this.options.ssid, wifiPassword: this.options.wifiPassword, firmware: this.options.firmware, media: this.options.media });
    this.udp = dgram.createSocket("udp4");
    this.tcp = net.createServer((socket) => this.handleTcp(socket));
    this.http = http.createServer((request, response) => this.handleHttp(request, response));
    this.sessions = new Map();
    this.tcpDecoders = new Map();
    this.videoAUs = loadVideoSource(this.options.videoSource);
    this.tcpStates = new Map();
    this.metrics = {
      packetsIn: 0,
      packetsOut: 0,
      invalidPackets: 0,
      droppedPackets: 0,
      malformedPackets: 0,
      outOfOrderPackets: 0,
      staleAcks: 0,
      duplicatePackets: 0,
      commands: 0,
      acceptedCommands: 0,
      rejectedCommands: 0,
      stateRejected: 0,
      parameterRejected: 0,
      unsupportedCommands: 0,
      responses: 0,
    };
    this.stopped = false;
  }

  listen() {
    let markReady;
    let failStart;
    this.ready = new Promise((resolve, reject) => {
      let remaining = 3;
      let settled = false;
      markReady = () => {
        remaining -= 1;
        if (remaining === 0 && !settled) {
          settled = true;
          resolve(this);
        }
      };
      failStart = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
    });
    this.udp.on("message", (message, rinfo) => this.handleUdp(message, rinfo));
    this.udp.once("error", failStart);
    this.udp.on("error", (error) => this.log("error", { surface: "udp", error: error.message }));
    this.udp.bind(this.options.udpPort, this.options.host, () => { this.log("ready", { surface: "udp", address: this.udp.address() }); markReady(); });
    this.tcp.once("error", failStart);
    this.tcp.on("error", (error) => this.log("error", { surface: "tcp", error: error.message }));
    this.tcp.listen(this.options.tcpPort, this.options.host, () => { this.log("ready", { surface: "tcp", address: this.tcp.address() }); markReady(); });
    this.http.once("error", failStart);
    this.http.on("error", (error) => this.log("error", { surface: "http", error: error.message }));
    this.http.listen(this.options.httpPort, this.options.host, () => { this.log("ready", { surface: "http", address: this.http.address(), model: this.state.profile.id }); markReady(); });
    this.log("start", { model: this.state.profile.id, udpPort: this.options.udpPort, tcpPort: this.options.tcpPort, httpPort: this.options.httpPort });
    return this.ready;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const session of this.sessions.values()) this.closeSession(session);
    this.udp.close();
    this.tcp.close();
    this.http.close();
    this.log("stop", this.metrics);
  }

  log(event, details = {}) {
    const entry = { time: new Date().toISOString(), event, ...details };
    if (this.options.log === "json") process.stdout.write(`${JSON.stringify(entry)}\n`);
    else process.stdout.write(`[${entry.time}] ${event}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}\n`);
  }

  sessionKey(rinfo) { return `${rinfo.address}:${rinfo.port}`; }

  getSession(rinfo) {
    const key = this.sessionKey(rinfo);
    let session = this.sessions.get(key);
    if (!session) {
      session = {
        key,
        address: rinfo.address,
        port: rinfo.port,
        sessionId: 0,
        baseSeq: 0,
        handshaken: false,
        expectedTransportSeq: null,
        lastCommandCounter: null,
        lastDumlSeq: null,
        nextDataSeq: 0,
        ackedData: 0,
        extra: 0,
        videoSeq: 0,
        ackSeen: { video: false, data: false, extra: false },
        registered: false,
        presence: false,
        lastPresenceAt: 0,
        gimbalReady: false,
        livePrepare: false,
        nanoLiveGate: false,
        subscribed: false,
        subscriptions: new Map(),
        nextSubscriptionId: 0x69df,
        mediaPhase: "idle",
        focusTapPhase: "idle",
        recentCommands: new Map(),
        liveTimer: null,
        statusTimer: null,
        statusTick: 0,
        videoIndex: 0,
      };
      this.sessions.set(key, session);
    }
    return session;
  }

  closeSession(session) {
    if (session.liveTimer) clearInterval(session.liveTimer);
    if (session.statusTimer) clearInterval(session.statusTimer);
    this.sessions.delete(session.key);
  }

  sendUdp(packet, session, label) {
    if (this.stopped) return;
    this.metrics.packetsOut += 1;
    const send = () => this.udp.send(packet, session.port, session.address, (error) => {
      if (error) this.log("error", { surface: "udp", label, error: error.message });
    });
    if (this.options.responseDelayMs > 0) setTimeout(send, this.options.responseDelayMs);
    else send();
    this.log("tx", { surface: "udp", label, bytes: packet.length, peer: session.key });
  }

  handleUdp(message, rinfo) {
    this.metrics.packetsIn += 1;
    let session = this.getSession(rinfo);
    let packet;
    try {
      packet = decodeTransport(message);
    } catch (error) {
      this.metrics.invalidPackets += 1;
      this.log("invalid", { surface: "udp", peer: session.key, reason: error.message, bytes: message.length });
      return;
    }
    this.log("rx", { surface: "udp", peer: session.key, pktType: `0x${packet.pktType.toString(16).padStart(2, "0")}`, seq: packet.seq, bytes: message.length });
    if (packet.pktType === PKT_HANDSHAKE) {
      const rebound = this.findSessionById(packet.sessionId, rinfo.address, session);
      if (rebound) {
        this.rebindSession(rebound, rinfo, session.key);
        session = rebound;
      }
      return this.handleHandshake(packet, session);
    }
    if (packet.sessionId !== session.sessionId || !session.handshaken) {
      const rebound = this.findSessionById(packet.sessionId, rinfo.address, session);
      if (rebound) {
        this.rebindSession(rebound, rinfo, session.key);
        session = rebound;
      }
    }
    if (packet.pktType === PKT_ACK) return this.handleAck(packet, session);
    if (packet.pktType !== PKT_COMMAND) return this.invalidCommand(session, `unsupported packet type 0x${packet.pktType.toString(16).padStart(2, "0")}`);
    if (packet.sessionId !== session.sessionId || !session.handshaken) return this.dropPacket(session, "command arrived before a valid handshake or session changed");
    if (packet.payload.length < 12) return this.dropPacket(session, "routing header is shorter than 12 bytes");

    const fingerprint = message.toString("hex");
    const previous = session.recentCommands.get(fingerprint);
    if (previous) {
      this.metrics.duplicatePackets += 1;
      this.log("duplicate", { surface: "udp", peer: session.key, seq: packet.seq });
      if (previous.responsePacket && !this.options.dropAcks) this.sendUdp(previous.responsePacket, session, "duplicate-reply");
      return;
    }

    const routeSeq = u16le(packet.payload, 2);
    const routePrevious = u16le(packet.payload, 0);
    const routeReserved = packet.payload.subarray(4, 8).some((value) => value !== 0)
      || packet.payload[9] !== 0x01 || packet.payload[10] !== 0x00 || packet.payload[11] !== 0x00;
    if (routeSeq !== packet.seq || routePrevious !== ((packet.seq - 8) & 0xffff) || routeReserved) {
      return this.dropPacket(session, "routing sequence or reserved bytes are invalid", true);
    }
    const decoded = decodeDuml(packet.payload, 12);
    if (decoded.status !== "ok" || decoded.consumed !== packet.payload.length - 12) {
      return this.dropPacket(session, decoded.reason || "command packet must contain exactly one CRC-valid DUML frame", false, true);
    }
    const commandCounter = packet.payload[8];
    const sequenceError = this.validateCommandSequence(session, packet, decoded.frame, commandCounter);
    if (sequenceError) return this.dropPacket(session, sequenceError, true);

    session.expectedTransportSeq = (packet.seq + 8) & 0xffff;
    session.lastCommandCounter = commandCounter;
    session.lastDumlSeq = decoded.frame.seq;
    session.recentCommands.set(fingerprint, { responsePacket: null });
    while (session.recentCommands.size > 256) session.recentCommands.delete(session.recentCommands.keys().next().value);
    const responsePacket = this.handleCommand(decoded.frame, session, fingerprint);
    const record = session.recentCommands.get(fingerprint);
    if (record) record.responsePacket = responsePacket;
  }

  findSessionById(sessionId, address, excluded) {
    for (const candidate of this.sessions.values()) {
      if (candidate !== excluded && candidate.handshaken && candidate.address === address && candidate.sessionId === sessionId) return candidate;
    }
    return null;
  }

  rebindSession(session, rinfo, placeholderKey) {
    const previousKey = session.key;
    const nextKey = this.sessionKey(rinfo);
    if (placeholderKey !== previousKey) this.sessions.delete(placeholderKey);
    this.sessions.delete(previousKey);
    session.key = nextKey;
    session.address = rinfo.address;
    session.port = rinfo.port;
    this.sessions.set(nextKey, session);
    this.log("udp-rebind", { from: previousKey, peer: nextKey, sessionId: session.sessionId });
  }

  invalidCommand(session, reason) {
    this.metrics.invalidPackets += 1;
    this.log("invalid", { surface: "udp", peer: session.key, reason });
  }

  dropPacket(session, reason, outOfOrder = false, malformed = false) {
    this.metrics.invalidPackets += 1;
    this.metrics.droppedPackets += 1;
    if (outOfOrder) this.metrics.outOfOrderPackets += 1;
    if (malformed) this.metrics.malformedPackets += 1;
    this.log("drop", { surface: "udp", peer: session.key, reason, outOfOrder, malformed });
  }

  validateCommandSequence(session, packet, frame, commandCounter) {
    if (!this.options.strictProtocol) return null;
    if (session.expectedTransportSeq !== null && packet.seq !== session.expectedTransportSeq) return `transport sequence expected ${session.expectedTransportSeq}, got ${packet.seq}`;
    if (session.lastCommandCounter !== null && commandCounter !== ((session.lastCommandCounter + 1) & 0xff)) return `command counter expected ${((session.lastCommandCounter + 1) & 0xff)}, got ${commandCounter}`;
    if (session.lastDumlSeq !== null && frame.seq !== ((session.lastDumlSeq + 1) & 0xffff)) return `DUML sequence expected ${((session.lastDumlSeq + 1) & 0xffff)}, got ${frame.seq}`;
    return null;
  }

  handleHandshake(packet, session) {
    if (this.options.dropHandshake) return this.log("drop", { surface: "udp", reason: "drop-handshake", peer: session.key });
    if (packet.payload.length !== 40) return this.dropPacket(session, "handshake payload must be 40 bytes", false, true);
    const baseSeq = u16le(packet.payload, 0);
    if (!packet.payload.equals(handshakePayload(baseSeq)) || (baseSeq & 7) !== 0) return this.dropPacket(session, "handshake payload is not valid", false, true);
    const sameSession = session.handshaken && session.sessionId === packet.sessionId && session.baseSeq === baseSeq;
    if (!sameSession) {
      this.stopLive(session);
      session.sessionId = packet.sessionId;
      session.baseSeq = baseSeq;
      session.handshaken = true;
      session.expectedTransportSeq = (baseSeq + 8) & 0xffff;
      session.lastCommandCounter = null;
      session.lastDumlSeq = null;
      session.nextDataSeq = baseSeq;
      session.ackedData = baseSeq;
      session.extra = baseSeq;
      session.videoSeq = baseSeq;
      session.ackSeen = { video: false, data: false, extra: false };
      session.registered = false;
      session.presence = false;
      session.lastPresenceAt = 0;
      session.gimbalReady = false;
      session.livePrepare = false;
      session.nanoLiveGate = false;
      session.subscribed = false;
      session.subscriptions.clear();
      session.nextSubscriptionId = 0x69df;
      session.mediaPhase = "idle";
      session.focusTapPhase = "idle";
      session.recentCommands.clear();
    } else {
      this.metrics.duplicatePackets += 1;
      this.log("duplicate", { surface: "udp", peer: session.key, reason: "handshake retransmission", sessionId: packet.sessionId });
    }
    this.sendUdp(handshakeDatagram({ sessionId: session.sessionId, seq: baseSeq, baseSeq }), session, "handshake");
    const telemetryPayload = Buffer.concat([
      Buffer.concat([putU16(baseSeq), putU16(baseSeq), Buffer.alloc(4)]),
      Buffer.concat([putU16(baseSeq), putU16(baseSeq), Buffer.alloc(4)]),
      Buffer.concat([putU16(baseSeq), putU16(baseSeq), Buffer.alloc(4)]),
      Buffer.alloc(2),
    ]);
    this.sendUdp(Buffer.concat([transportHeader({ pktType: PKT_TELEMETRY, payloadLength: telemetryPayload.length, sessionId: session.sessionId, seq: baseSeq }), telemetryPayload]), session, "telemetry-window");
  }

  validateSessionCommand(frame, session) {
    const key = opcode(frame);
    const invalid = (code, reason) => ({ ok: false, code, reason });
    const expectedReceiver = this.expectedReceiver(frame);
    if (this.options.strictProtocol && frame.sender !== 0x02) return invalid(0xdf, "command sender must be the app address 0x02");
    if (this.options.strictProtocol && expectedReceiver !== null && !expectedReceiver.includes(frame.receiver)) return invalid(0xdf, `receiver 0x${frame.receiver.toString(16)} is invalid for ${key}`);
    const expectedFlags = key === "00/81" ? 0x80 : isNotification(frame) ? 0x00 : 0x40;
    if (this.options.strictProtocol && frame.flags !== expectedFlags) return invalid(0xdf, `${key} must use request flags 0x${expectedFlags.toString(16)}`);

    const lifecycle = this.validateLifecycle(frame, session);
    if (lifecycle) return lifecycle;

    const validation = this.state.validate(frame);
    if (!validation.ok) return validation;
    if (key === "00/99") {
      const subscription = parseSubscription(frame.payload);
      if (session.subscriptions.has(subscription.name)) return invalid(0xd9, `subscription ${subscription.name} is already registered`);
      if (this.options.strictProtocol && subscription.subId !== session.nextSubscriptionId) return invalid(0xd9, `subscription id expected ${session.nextSubscriptionId}, got ${subscription.subId}`);
    }
    if (key === "00/26" && this.options.strictProtocol) {
      const isTrigger = frame.payload[1] === 0x04;
      if (isTrigger && session.mediaPhase !== "sd-listed") return invalid(0xd9, "media trigger must follow the SD media list");
      if (!isTrigger && frame.payload[4] === 1 && session.mediaPhase !== "idle") return invalid(0xd9, "SD media list is out of order");
      if (!isTrigger && frame.payload[4] === 2 && session.mediaPhase !== "triggered") return invalid(0xd9, "internal media list must follow the media trigger");
    }
    return validation;
  }

  expectedReceiver(frame) {
    const key = opcode(frame);
    if (["00/81"].includes(key)) return [0x48];
    if (["00/88", "00/99"].includes(key)) return [0x28];
    if (["03/da"].includes(key)) return [0x03];
    if (["07/07", "07/0e", "07/39", "07/45", "07/46", "07/47", "07/48", "07/ab"].includes(key)) return [0x07];
    if (["08/78"].includes(key)) return [0x08];
    if (["08/8e", "08/e1"].includes(key)) return [0x02, 0x08];
    if (["09/a8"].includes(key)) return [this.state.profile.receiver];
    if (["53/10"].includes(key)) return [0x1c];
    if (key === "02/e1" || key === "02/8e") return [0x01, 0x08];
    if (key.startsWith("02/") || key === "00/26" || key === "00/28") return [0x01];
    if (key.startsWith("04/")) return [0x04];
    return null;
  }

  validateLifecycle(frame, session) {
    if (!this.options.strictProtocol) return null;
    const key = opcode(frame);
    const reject = (reason) => ({ ok: false, code: 0xd9, reason });
    const setupBeforeRegistration = new Set(["07/07", "07/0e"]);
    if (key === "00/81") {
      if (!session.handshaken) return reject("registration requires a completed UDP handshake");
      if (session.registered) return reject("registration has already completed for this session");
      return null;
    }
    if (setupBeforeRegistration.has(key)) return null;
    if (key === "00/88") {
      if (!session.registered) return reject("presence requires registration");
      return null;
    }
    if (key === "03/da") {
      if (!session.registered || !session.presence) return reject("gimbal initialization requires registration and presence");
      if (session.gimbalReady) return reject("gimbal initialization has already completed");
      return null;
    }
    if (key === "00/99") {
      if (!session.registered || !session.presence) return reject("subscription requires registration and presence");
      if (this.state.profile.hasGimbal && !session.gimbalReady) return reject("subscription requires gimbal initialization");
      return null;
    }
    if (["07/39", "07/48", "07/ab", "07/47"].includes(key)) return null;
    if (!session.registered || !session.presence) return reject("camera command requires registration and current presence");
    if (!session.subscribed) return reject("camera command requires at least one status subscription");
    if (this.options.presenceTimeoutMs > 0 && Date.now() - session.lastPresenceAt > this.options.presenceTimeoutMs) {
      session.presence = false;
      return reject("app presence lease has expired");
    }
    if (key === "02/68" && this.state.profile.id === "nano") return reject("Nano does not use the Pocket live preparation command");
    if (key === "09/a8") {
      if (this.state.inPlayback) return reject("live view cannot start during playback");
      if (this.state.profile.id === "nano" ? !session.nanoLiveGate : !session.livePrepare) return reject("live enable arrived before the model-specific live preparation");
    }
    if (key === "02/09" && frame.payload[10] === 3 && session.nanoLiveGate) return reject("Nano live gate is already enabled");
    if (key === "02/09" && frame.payload[10] === 4 && !session.nanoLiveGate) return reject("Nano live gate cannot stop before it starts");

    const tapSequence = {
      "02/22": ["idle", "prepared"],
      "02/30": ["prepared", "point"],
      "02/32": ["hint", "idle"],
    }[key];
    if (tapSequence && session.focusTapPhase !== tapSequence[0]) return reject(`tap focus is out of order: expected ${tapSequence[0]}, got ${session.focusTapPhase}`);
    if (key === "02/68" && !["idle", "point"].includes(session.focusTapPhase)) return reject(`tap focus is out of order: expected point or a normal live prepare, got ${session.focusTapPhase}`);
    if (!tapSequence && key !== "02/68" && session.focusTapPhase !== "idle" && key !== "00/88") return reject(`tap focus is out of order: expected the next tap-focus step, got ${key}`);
    return null;
  }

  updateSessionLifecycle(frame, session) {
    switch (opcode(frame)) {
      case "00/81": session.registered = true; break;
      case "00/88": session.presence = true; session.lastPresenceAt = Date.now(); break;
      case "03/da": session.gimbalReady = true; break;
      case "02/68":
        session.livePrepare = true;
        if (session.focusTapPhase === "point") session.focusTapPhase = "hint";
        break;
      case "02/09": session.nanoLiveGate = frame.payload[10] === 3; break;
      case "02/22": session.focusTapPhase = "prepared"; break;
      case "02/30": session.focusTapPhase = "point"; break;
      case "02/32": session.focusTapPhase = "idle"; break;
      case "00/99": session.subscribed = true; break;
      case "00/26":
        if (frame.payload[1] === 0x04) session.mediaPhase = "triggered";
        else if (frame.payload[4] === 1) session.mediaPhase = "sd-listed";
        else if (frame.payload[4] === 2) session.mediaPhase = "idle";
        break;
      case "02/0c":
        if (frame.payload[3] === 1) {
          session.nanoLiveGate = false;
        }
        break;
      default: break;
    }
  }

  handleAck(packet, session) {
    if (packet.sessionId !== session.sessionId || !session.handshaken) return this.dropPacket(session, "ACK arrived before a valid handshake or session changed");
    if (packet.payload.length !== 26 || packet.seq !== 0 || !sameU16Pair(packet.payload, 0) || !sameU16Pair(packet.payload, 8) || !sameU16Pair(packet.payload, 16) || packet.payload.subarray(4, 8).some((value) => value !== 0) || packet.payload.subarray(12, 16).some((value) => value !== 0) || packet.payload.subarray(20, 26).some((value) => value !== 0)) return this.dropPacket(session, "ACK payload or sequence is invalid", false, true);
    const cursors = [u16le(packet.payload, 0), u16le(packet.payload, 8), u16le(packet.payload, 16)];
    const fields = ["videoSeq", "ackedData", "extra"];
    const seen = ["video", "data", "extra"];
    for (let index = 0; index < cursors.length; index += 1) {
      if (!session.ackSeen[seen[index]] || isNewer16(cursors[index], session[fields[index]])) {
        session[fields[index]] = cursors[index];
        session.ackSeen[seen[index]] = true;
      } else if (cursors[index] !== session[fields[index]]) {
        this.metrics.staleAcks += 1;
        this.log("stale-ack", {
          surface: "udp",
          peer: session.key,
          stream: seen[index],
          cursor: cursors[index],
          current: session[fields[index]],
        });
      }
    }
  }

  handleCommand(frame, session, fingerprint = null) {
    this.metrics.commands += 1;
    const validation = this.validateSessionCommand(frame, session);
    this.log("command", { surface: "udp", peer: session.key, opcode: opcode(frame), seq: frame.seq, payload: hex(frame.payload), valid: validation.ok, reason: validation.reason });
    if (validation.ok) {
      this.state.apply(frame);
      this.metrics.acceptedCommands += 1;
    } else {
      this.metrics.rejectedCommands += 1;
      if (validation.code === 0xd9) this.metrics.stateRejected += 1;
      else if (validation.code === 0xdf) this.metrics.parameterRejected += 1;
      else if (validation.code === 0xe0) this.metrics.unsupportedCommands += 1;
    }
    const key = opcode(frame);
    if (validation.ok) this.updateSessionLifecycle(frame, session);
    if (key === "00/99" && validation.ok) {
      const subscription = parseSubscription(frame.payload);
      this.state.subscriptions.set(subscription.name, subscription.subId);
      session.subscriptions.set(subscription.name, subscription.subId);
      session.nextSubscriptionId = (subscription.subId + 1) >>> 0;
      session.subscribed = true;
      this.pushSubscription(session, subscription.name, subscription.subId);
      if (session.subscriptions.size === 1) {
        for (const status of this.state.statusFrames()) this.pushFrame(session, { ...status, sender: status.cmdSet === 0x04 ? 0x04 : 0x01, receiver: 0x02, seq: session.nextDataSeq }, `push-${opcode(status)}`);
        this.startStatus(session);
      }
    }
    if (key === "07/ab" && validation.ok) {
      setImmediate(() => this.sendWifiScan(session));
    }
    if (key === "09/a8" && validation.ok) this.startLive(session);
    if (key === "02/09" && validation.ok && frame.payload[10] === 4) this.stopLive(session);
    if (key === "02/0c" && validation.ok && frame.payload[3] === 1) this.stopLive(session);
    let responsePacket = null;
    if (validation.ok && !this.options.dropAcks && !isNotification(frame)) {
      const payload = this.replyPayload(frame);
      const flags = frame.cmdSet === 0x04 || frame.cmdSet === 0x03 ? FLAG_ACK_80 : FLAG_RESPONSE;
      responsePacket = this.sendReply(session, responseFrame(frame, payload, flags, frame.cmdSet === 0x04 ? 0x04 : 0x01));
    } else if (!validation.ok && !this.options.dropAcks && !isNotification(frame)) {
      const flags = frame.cmdSet === 0x04 || frame.cmdSet === 0x03 ? FLAG_ACK_80 : FLAG_RESPONSE;
      responsePacket = this.sendReply(session, responseFrame(frame, Buffer.from([validation.code]), flags, frame.cmdSet === 0x04 ? 0x04 : 0x01));
    }
    if (validation.ok && key === "00/26") {
      setImmediate(() => this.sendMediaManifest(session, frame));
    }
    if (validation.ok && ["02/02", "02/0c", "02/18", "02/1e", "02/24", "02/28", "02/2a", "02/2c", "02/2e", "02/30", "02/32", "02/42", "02/8e", "02/9f", "02/a6", "02/b8", "04/14", "04/4c", "04/50"].includes(key)) this.pushAllSubscriptions(session);
    if (validation.ok && (key === "04/01" || key === "04/14" || key === "04/4c" || key === "04/50")) this.pushGimbalStatus(session);
    return responsePacket;
  }

  replyPayload(frame) {
    const key = opcode(frame);
    if (key === "02/8e") {
      const verb = frame.payload[0];
      const pid = u16le(frame.payload, 2);
      if (verb === 0) return paramGetReply(pid, this.state.paramValue(pid));
      return Buffer.from([0]);
    }
    if (key === "02/a0") return Buffer.concat([Buffer.from([0]), this.state.audioDsp]);
    if (key === "02/a5") return Buffer.from([0, this.state.tracking ? 1 : 0, 0, 0]);
    if (key === "07/45") return Buffer.from([0, 1]);
    if (key === "07/ab") return Buffer.from([0]);
    if (key === "07/47") return Buffer.from([0, 0]);
    if (key === "07/48") return Buffer.from([0, 0]);
    if (key === "04/50") return frame.payload[0] === 1 ? Buffer.from([0, 1, 4, 1, this.state.gimbal.tiltLock, 5, 1, this.state.gimbal.speed]) : Buffer.from([0]);
    if (key === "07/39") return Buffer.from([0, this.state.stationMode ? 1 : 0]);
    if (["00/28", "02/bf", "02/0c", "02/02", "02/01", "02/09", "02/18", "02/1e", "02/22", "02/24", "02/28", "02/2a", "02/2c", "02/2e", "02/30", "02/32", "02/42", "02/68", "02/9f", "02/a6", "02/b8", "04/4c", "04/14", "03/da", "07/45", "07/47", "07/48", "08/78", "08/8e", "08/e1", "09/a8"].includes(key)) return Buffer.from([0]);
    if (key === "07/07") return Buffer.concat([Buffer.from([0]), packString(this.state.ssid)]);
    if (key === "07/0e") return Buffer.concat([Buffer.from([0]), packString(this.state.wifiPassword)]);
    if (key === "53/10") return Buffer.from([1, 0, 0, 0]);
    return Buffer.from([0]);
  }

  sendReply(session, frame) {
    this.metrics.responses += 1;
    const packet = dataDatagram({ pktType: PKT_ACKED_DATA, sessionId: session.sessionId, seq: session.nextDataSeq, payload: encodeDuml(frame) });
    session.ackedData = session.nextDataSeq;
    session.nextDataSeq = (session.nextDataSeq + 8) & 0xffff;
    this.sendUdp(packet, session, `reply-${opcode(frame)}`);
    return packet;
  }

  pushFrame(session, frame, label) {
    const packet = dataDatagram({ pktType: PKT_ACKED_DATA, sessionId: session.sessionId, seq: session.nextDataSeq, payload: encodeDuml(frame) });
    session.ackedData = session.nextDataSeq;
    session.nextDataSeq = (session.nextDataSeq + 8) & 0xffff;
    this.sendUdp(packet, session, label);
  }

  pushAllSubscriptions(session) {
    for (const [name, subId] of session.subscriptions) this.pushSubscription(session, name, subId);
    for (const frame of this.state.statusFrames()) this.pushFrame(session, { ...frame, sender: frame.cmdSet === 0x04 ? 0x04 : 0x01, receiver: 0x02, seq: session.nextDataSeq }, `push-${opcode(frame)}`);
  }

  pushGimbalStatus(session) {
    if (this.stopped || !session.handshaken || !session.subscribed) return;
    for (const frame of this.state.statusFrames().filter((candidate) => candidate.cmdSet === 0x04)) {
      this.pushFrame(session, { ...frame, sender: 0x04, receiver: 0x02, seq: session.nextDataSeq }, `push-${opcode(frame)}`);
    }
  }

  startStatus(session) {
    if (session.statusTimer) return;
    session.statusTick = 0;
    session.statusTimer = setInterval(() => {
      if (this.stopped || !session.handshaken || !session.subscribed) return;
      this.pushGimbalStatus(session);
      session.statusTick += 1;
      if (session.statusTick % 10 !== 0) return;
      for (const [name, subId] of session.subscriptions) this.pushSubscription(session, name, subId);
      for (const status of this.state.statusFrames().filter((candidate) => candidate.cmdSet !== 0x04)) {
        this.pushFrame(session, { ...status, sender: 0x01, receiver: 0x02, seq: session.nextDataSeq }, `push-${opcode(status)}`);
      }
    }, 100);
  }

  pushSubscription(session, name, subId) {
    const frame = { sender: 0x01, receiver: 0x02, seq: session.nextDataSeq, flags: 0, cmdSet: 0x00, cmdId: 0x99, payload: packSubscribePush(name, this.state.subscribedValue(name), subId) };
    this.pushFrame(session, frame, `status-${name}`);
  }

  sendWifiScan(session) {
    if (this.stopped || !session.handshaken) return;
    this.pushFrame(session, {
      sender: 0x07,
      receiver: 0x02,
      seq: session.nextDataSeq,
      flags: 0,
      cmdSet: 0x07,
      cmdId: 0xac,
      payload: wifiScanReply([this.state.ssid, "OPC-MOCK-NET"]),
    }, "wifi-scan-07/ac");
  }

  sendMediaManifest(session, request) {
    if (this.stopped || !session.handshaken) return;
    const counter = request.payload[4];
    const storage = counter === 1 ? 0 : counter === 2 ? 1 : null;
    const files = storage === null
      ? []
      : this.state.media.filter((file) => (this.state.profile.internalStorage ? file.storage : 0) === storage);
    const bytes = mediaManifest(files);
    const chunkSize = 1000;
    if (bytes.length > 4) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
        const payload = Buffer.alloc(10 + chunk.length);
        payload[0] = 0x4a;
        payload[1] = 0x01;
        payload[4] = counter;
        chunk.copy(payload, 10);
        this.pushFrame(session, {
          sender: 0x01,
          receiver: 0x02,
          seq: session.nextDataSeq,
          flags: 0,
          cmdSet: 0x00,
          cmdId: 0x27,
          payload,
        }, `media-chunk-${counter}`);
      }
    }
    const end = Buffer.alloc(10);
    end[0] = 0x4a;
    end[1] = 0x03;
    end[4] = counter;
    this.pushFrame(session, {
      sender: 0x01,
      receiver: 0x02,
      seq: session.nextDataSeq,
      flags: 0,
      cmdSet: 0x00,
      cmdId: 0x27,
      payload: end,
    }, `media-end-${counter}`);
  }

  startLive(session) {
    if (!this.videoAUs.length || this.options.dropVideo) return;
    // Each enable is the mock's deterministic IDR boundary. Restarting the
    // source here lets recovery tests begin with the same parameter sets.
    session.videoIndex = 0;
    if (session.liveTimer) return;
    session.liveTimer = setInterval(() => this.sendVideo(session), 40);
    this.log("live", { action: "start", peer: session.key, sourceAUs: this.videoAUs.length });
  }

  stopLive(session) {
    if (session.liveTimer) clearInterval(session.liveTimer);
    session.liveTimer = null;
    this.log("live", { action: "stop", peer: session.key });
  }

  sendVideo(session) {
    if (!this.state.liveEnabled || !this.videoAUs.length || this.options.dropVideo) return;
    const au = this.videoAUs[session.videoIndex % this.videoAUs.length];
    session.videoIndex += 1;
    const marker = Buffer.concat([Buffer.from([0, 0, 1, 0xff]), putU32(au.length), Buffer.alloc(8)]);
    const body = Buffer.concat([marker, au]);
    const maxFragment = 1200;
    for (let offset = 0; offset < body.length; offset += maxFragment) {
      const fragment = body.subarray(offset, offset + maxFragment);
      const videoHeader = Buffer.alloc(12);
      videoHeader[8] = session.videoIndex & 0xff;
      videoHeader[9] = 0;
      videoHeader[10] = Math.floor(offset / maxFragment) & 0xff;
      const packet = Buffer.concat([transportHeader({ pktType: PKT_VIDEO, payloadLength: videoHeader.length + fragment.length, sessionId: session.sessionId, seq: session.videoSeq }), videoHeader, fragment]);
      this.sendUdp(packet, session, "video");
      session.videoSeq = (session.videoSeq + 8) & 0xffff;
    }
  }

  sendTcp(socket, frame) {
    if (this.stopped || this.options.dropAcks) return;
    const packet = encodeDuml(frame);
    this.sendTcpPacket(socket, packet, `reply-${opcode(frame)}`);
    return packet;
  }

  sendTcpPacket(socket, packet, label = "reply") {
    if (this.stopped || this.options.dropAcks) return;
    this.metrics.responses += 1;
    const send = () => {
      if (!socket.destroyed) socket.write(packet);
    };
    if (this.options.responseDelayMs > 0) setTimeout(send, this.options.responseDelayMs);
    else send();
    this.log("tx", { surface: "tcp", label, bytes: packet.length });
  }

  handleTcp(socket) {
    const decoder = new DumlStreamDecoder();
    this.tcpDecoders.set(socket, decoder);
    const tcpState = { paired: false, lastSeq: null, recentFrames: new Map(), pairingPayload: null };
    this.tcpStates.set(socket, tcpState);
    this.log("tcp-connect", { peer: `${socket.remoteAddress}:${socket.remotePort}` });
    socket.on("data", (chunk) => {
      const invalidBefore = decoder.invalidFrames;
      const frames = decoder.push(chunk);
      if (decoder.invalidFrames > invalidBefore) {
        const count = decoder.invalidFrames - invalidBefore;
        this.metrics.invalidPackets += count;
        this.metrics.droppedPackets += count;
        this.metrics.malformedPackets += count;
        this.log("drop", { surface: "tcp", peer: `${socket.remoteAddress}:${socket.remotePort}`, reason: decoder.lastError, malformed: true, count });
      }
      for (const frame of frames) {
        this.metrics.commands += 1;
        const fingerprint = encodeDuml(frame).toString("hex");
        const previous = tcpState.recentFrames.get(fingerprint);
        if (tcpState.recentFrames.has(fingerprint)) {
          this.metrics.duplicatePackets += 1;
          this.log("duplicate", { surface: "tcp", peer: `${socket.remoteAddress}:${socket.remotePort}`, opcode: opcode(frame), seq: frame.seq });
          if (previous && !this.options.dropAcks) this.sendTcpPacket(socket, previous, "duplicate-reply");
          continue;
        }
        tcpState.recentFrames.set(fingerprint, null);
        if (tcpState.recentFrames.size > 64) tcpState.recentFrames.delete(tcpState.recentFrames.keys().next().value);
        const validation = this.validateTcpCommand(frame, tcpState);
        this.log("command", { surface: "tcp", opcode: opcode(frame), seq: frame.seq, payload: hex(frame.payload), valid: validation.ok, reason: validation.reason });
        if (validation.ok) {
          this.state.apply(frame);
          this.metrics.acceptedCommands += 1;
          tcpState.paired = true;
          tcpState.lastSeq = frame.seq;
          tcpState.pairingPayload = Buffer.from(frame.payload);
        } else {
          this.metrics.rejectedCommands += 1;
          if (validation.code === 0xd9) this.metrics.stateRejected += 1;
          else if (validation.code === 0xdf) this.metrics.parameterRejected += 1;
          else if (validation.code === 0xe0) this.metrics.unsupportedCommands += 1;
        }
        const payload = validation.ok ? this.replyPayload(frame) : Buffer.from([validation.code]);
        const flags = frame.cmdSet === 0x04 || frame.cmdSet === 0x03 ? FLAG_ACK_80 : FLAG_RESPONSE;
        const response = responseFrame(frame, payload, flags, frame.cmdSet === 0x04 ? 0x04 : 0x01);
        const responsePacket = this.sendTcp(socket, response);
        tcpState.recentFrames.set(fingerprint, responsePacket);
      }
    });
    socket.on("close", () => {
      this.tcpDecoders.delete(socket);
      this.tcpStates.delete(socket);
    });
    socket.on("error", (error) => this.log("error", { surface: "tcp", error: error.message }));
  }

  validateTcpCommand(frame, tcpState) {
    const invalid = (code, reason) => ({ ok: false, code, reason });
    if (this.options.strictProtocol && (frame.sender !== 0x02 || frame.receiver !== 0x07 || frame.flags !== 0x40)) return invalid(0xdf, "TCP pairing must be an app request to receiver 0x07");
    if (opcode(frame) !== "07/45") return invalid(0xe0, "TCP only accepts the pairing poke 0x07/0x45");
    const validation = this.state.validate(frame);
    if (!validation.ok) return validation;
    if (this.options.strictProtocol && tcpState.paired && tcpState.pairingPayload && !frame.payload.equals(tcpState.pairingPayload)) return invalid(0xd9, "TCP pairing payload changed after the connection was paired");
    if (this.options.strictProtocol && tcpState.paired && frame.seq !== tcpState.lastSeq) return invalid(0xd9, "TCP pairing sequence changed after the connection was paired");
    return validation;
  }

  handleHttp(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/health") return this.writeJson(response, 200, { ok: true, metrics: this.metrics });
    if (request.method === "GET" && url.pathname === "/state") return this.writeJson(response, 200, jsonSafeState(this.state));
    if (request.method === "POST" && url.pathname === "/control") return this.handleControl(request, response);
    if (request.method !== "GET" || url.pathname !== "/v2") return this.writeJson(response, 404, { error: "not found" });
    const storage = url.searchParams.get("storage");
    const virtualPath = url.searchParams.get("path");
    if (!/^[01]$/.test(storage || "") || !isSafeVirtualPath(virtualPath)) return this.writeJson(response, 400, { error: "storage must be 0 or 1 and path must be a safe relative camera path" });
    const file = this.findMediaFile(virtualPath);
    if (!file) return this.writeJson(response, 404, { error: "camera path is not in the mock catalog" });
    const requestedStorage = Number(storage);
    const expectedStorage = this.state.profile.internalStorage ? file.storage : 0;
    if (requestedStorage !== expectedStorage) return this.writeJson(response, 404, { error: "camera path is not on the requested storage" });
    const bytes = this.readMedia(file, virtualPath);
    if (!bytes) return this.writeJson(response, 404, { error: "file is not present; configure --media-root" });
    this.writeRange(response, request, bytes, mimeFor(virtualPath));
  }

  readMedia(file, virtualPath) {
    if (this.options.mediaRoot) {
      const root = path.join(this.options.mediaRoot, virtualPath);
      if (root !== this.options.mediaRoot && root.startsWith(`${this.options.mediaRoot}${path.sep}`) && fs.existsSync(root) && fs.statSync(root).isFile()) return fs.readFileSync(root);
    }
    if (virtualPath.endsWith(".scr")) return JPEG_1X1;
    return Buffer.from(`OpenPocketCine mock media: ${file.path}\n`, "ascii");
  }

  writeRange(response, request, bytes, type) {
    let start = 0;
    let end = bytes.length - 1;
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return this.writeJson(response, 416, { error: "invalid Range" });
      if (!match[1] && !match[2]) return this.writeJson(response, 416, { error: "invalid Range" });
      if (match[1]) {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : bytes.length - 1;
      } else {
        const suffix = Number(match[2]);
        if (!Number.isInteger(suffix) || suffix <= 0) return this.writeJson(response, 416, { error: "range is outside file" });
        start = Math.max(0, bytes.length - suffix);
      }
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= bytes.length) return this.writeJson(response, 416, { error: "range is outside file" });
      end = Math.min(end, bytes.length - 1);
    }
    const body = bytes.subarray(start, end + 1);
    response.writeHead(range ? 206 : 200, {
      "Accept-Ranges": "bytes",
      "Content-Length": body.length,
      "Content-Type": type,
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}),
      Connection: "keep-alive",
    });
    response.end(body);
  }

  findMediaFile(virtualPath) {
    return this.state.media.find((item) => {
      const base = item.path.replace(/\.[^.]+$/, "");
      return item.path === virtualPath || item.thumbPath === virtualPath || `${base}.LRF` === virtualPath || `${base}.XRF` === virtualPath;
    });
  }

  handleControl(request, response) {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (body.action === "reset") {
          this.resetDevice();
        } else if (body.action === "patch") {
          applyControlPatch(this.state, body.patch || {});
        } else if (body.action === "fault") {
          if (!["dropHandshake", "dropAcks", "dropVideo", "responseDelayMs"].includes(body.name)) throw new Error("unknown fault name");
          if (body.name === "responseDelayMs") this.options.responseDelayMs = boundedNumber(body.value, 0, 60000);
          else {
            this.options[body.name] = Boolean(body.value);
            if (body.name === "dropVideo") {
              for (const session of this.sessions.values()) {
                if (this.options.dropVideo) this.stopLive(session);
                else if (session.handshaken && this.state.liveEnabled) this.startLive(session);
              }
            }
          }
        } else {
          throw new Error("action must be reset, patch, or fault");
        }
        this.writeJson(response, 200, { ok: true, state: jsonSafeState(this.state) });
      } catch (error) {
        this.writeJson(response, 400, { ok: false, error: error.message });
      }
    });
  }

  resetDevice() {
    for (const session of [...this.sessions.values()]) this.closeSession(session);
    for (const socket of this.tcpStates.keys()) socket.destroy();
    this.state = new MockCameraState({ model: this.options.model, deviceName: this.options.deviceName, ssid: this.options.ssid, wifiPassword: this.options.wifiPassword, firmware: this.options.firmware, media: this.options.media });
  }

  writeJson(response, status, value) {
    response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(JSON.stringify(value)) });
    response.end(JSON.stringify(value));
  }
}

function putU16(value) {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value & 0xffff);
  return out;
}

function sameU16Pair(buffer, offset) {
  return buffer.readUInt16LE(offset) === buffer.readUInt16LE(offset + 2);
}

function isNewer16(candidate, current) {
  const distance = (candidate - current) & 0xffff;
  return distance > 0 && distance < 0x8000;
}

function putU32(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
}

function wifiScanReply(names) {
  const records = names.map((name) => {
    const bytes = Buffer.from(name, "utf8");
    return Buffer.concat([Buffer.from([bytes.length + 6]), Buffer.alloc(5), bytes]);
  });
  return Buffer.concat([Buffer.from([1, 0x11, 0, 0]), ...records]);
}

function loadVideoSource(filename) {
  if (!filename) return [];
  const lines = fs.readFileSync(filename, "utf8").split(/\r?\n/).map((line) => line.replace(/\s+#.*$/, "").trim()).filter(Boolean);
  return lines.map((line, index) => {
    if (!/^(?:[0-9a-f]{2}\s*)+$/i.test(line)) throw new Error(`video source line ${index + 1} is not hex`);
    return Buffer.from(line.replace(/\s+/g, ""), "hex");
  });
}

function isSafeVirtualPath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 255 && !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes("..") && /^[\x20-\x7e]+$/.test(value);
}

function mimeFor(value) {
  if (/\.scr$/i.test(value) || /\.(jpg|jpeg)$/i.test(value)) return "image/jpeg";
  if (/\.(mp4|mov|lrf|xrf|lrv)$/i.test(value)) return "video/mp4";
  return "application/octet-stream";
}

function boundedNumber(value, min, max) {
  const number = value;
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`value must be between ${min} and ${max}`);
  return number;
}

export function applyControlPatch(state, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("patch must be an object");
  const allowed = new Set([
    "recording", "inPlayback", "liveEnabled", "stationMode", "streaming", "shootingMode", "expoMode",
    "shutterDenom", "isoIndex", "isoLimit", "ev", "color", "fov", "focusMode", "focusTrack", "audioChannel",
    "vocalBoost", "selfieFlip", "tracking", "zoomLens", "batteryPercent", "batteryMilliVolts",
    "batteryMilliAmps", "charging", "docked", "sdTotalMb", "sdFreeMb", "internalTotalMb", "internalFreeMb",
    "focusPoint", "wb",
  ]);
  for (const field of Object.keys(patch)) if (!allowed.has(field)) throw new Error(`unknown state field ${field}`);

  const booleans = ["recording", "inPlayback", "liveEnabled", "stationMode", "streaming", "selfieFlip", "tracking", "charging", "docked"];
  const changes = {};
  const candidate = {
    recording: state.recording,
    inPlayback: state.inPlayback,
    liveEnabled: state.liveEnabled,
    stationMode: state.stationMode,
    streaming: state.streaming,
    selfieFlip: state.selfieFlip,
    tracking: state.tracking,
    charging: state.charging,
    docked: state.docked,
    shootingMode: state.shootingMode,
    expoMode: state.expoMode,
    shutterDenom: state.shutterDenom,
    isoIndex: state.isoIndex,
    isoLimit: state.isoLimit,
    ev: state.ev,
    color: state.color,
    fov: state.fov,
    focusMode: state.focusMode,
    focusTrack: state.focusTrack,
    audioChannel: state.audioChannel,
    vocalBoost: state.vocalBoost,
    zoomLens: state.zoomLens,
    batteryPercent: state.batteryPercent,
    batteryMilliVolts: state.batteryMilliVolts,
    batteryMilliAmps: state.batteryMilliAmps,
    sdTotalMb: state.sdTotalMb,
    sdFreeMb: state.sdFreeMb,
    internalTotalMb: state.internalTotalMb,
    internalFreeMb: state.internalFreeMb,
    focusX: state.focusX,
    focusY: state.focusY,
    wbMode: state.wbMode,
    wbKelvin: state.wbKelvin,
    wbTint: state.wbTint,
  };
  for (const field of booleans) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    if (typeof patch[field] !== "boolean") throw new Error(`${field} must be boolean`);
    candidate[field] = patch[field];
    changes[field] = patch[field];
  }

  const integerRanges = {
    shootingMode: [0, 0xff], expoMode: [0, 0xff], shutterDenom: [1, 16000], isoIndex: [0, 0xff],
    isoLimit: [0, 0xff], ev: [0, 0xff], color: [0, 0xff], fov: [1, 5], focusMode: [1, 2], focusTrack: [0, 3], vocalBoost: [0, 1],
    audioChannel: [1, 3], zoomLens: [217, 2604], batteryPercent: [0, 100], batteryMilliVolts: [0, 10000],
    batteryMilliAmps: [-100000, 100000], sdTotalMb: [0, 0xffffffff], sdFreeMb: [0, 0xffffffff],
    internalTotalMb: [0, 0xffffffff], internalFreeMb: [0, 0xffffffff],
  };
  for (const [field, [min, max]] of Object.entries(integerRanges)) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    const value = patch[field];
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${field} must be an integer from ${min} to ${max}`);
    candidate[field] = value;
    changes[field] = value;
  }

  if (patch.focusPoint !== undefined) {
    if (!patch.focusPoint || typeof patch.focusPoint !== "object" || Array.isArray(patch.focusPoint)) throw new Error("focusPoint must be an object");
    candidate.focusX = boundedNumber(patch.focusPoint.x, 0, 1);
    candidate.focusY = boundedNumber(patch.focusPoint.y, 0, 1);
    changes.focusX = candidate.focusX;
    changes.focusY = candidate.focusY;
  }
  if (patch.wb !== undefined) {
    if (!patch.wb || typeof patch.wb !== "object" || Array.isArray(patch.wb)) throw new Error("wb must be an object");
    if (![0, 6].includes(patch.wb.mode)) throw new Error("wb.mode must be 0 or 6");
    candidate.wbMode = patch.wb.mode;
    candidate.wbKelvin = boundedNumber(patch.wb.kelvin, 2000, 10000);
    candidate.wbTint = boundedNumber(patch.wb.tint, -100, 100);
    changes.wbMode = candidate.wbMode;
    changes.wbKelvin = candidate.wbKelvin;
    changes.wbTint = candidate.wbTint;
  }

  if (candidate.recording && candidate.inPlayback) throw new Error("recording and inPlayback cannot both be true");
  if (candidate.liveEnabled && candidate.inPlayback) throw new Error("liveEnabled and inPlayback cannot both be true");
  if (!state.profile.modes.includes(candidate.shootingMode)) throw new Error(`shootingMode ${candidate.shootingMode} is not supported by ${state.profile.id}`);
  if (!state.profile.colors.includes(candidate.color)) throw new Error(`color ${candidate.color} is not supported by ${state.profile.id}`);
  if (![0x01, 0x05].includes(candidate.fov)) throw new Error(`fov ${candidate.fov} is not supported`);
  if (!state.profile.supportsFocus && (candidate.focusMode !== state.focusMode || candidate.focusTrack !== state.focusTrack || candidate.focusX !== state.focusX || candidate.focusY !== state.focusY)) throw new Error(`${state.profile.id} does not support camera focus`);
  const zoomBounds = state.zoomLensBounds({ shootingMode: candidate.shootingMode });
  if (candidate.zoomLens < zoomBounds.min || candidate.zoomLens > zoomBounds.max) throw new Error(`zoomLens must be between ${zoomBounds.min} and ${zoomBounds.max} for ${state.profile.id}`);
  if (candidate.sdFreeMb > candidate.sdTotalMb) throw new Error("sdFreeMb cannot exceed sdTotalMb");
  if (candidate.internalFreeMb > candidate.internalTotalMb) throw new Error("internalFreeMb cannot exceed internalTotalMb");

  Object.assign(state, changes);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(usage());
    else {
      const server = new MockCameraServer(options);
      process.once("SIGINT", () => { server.stop(); process.exit(0); });
      process.once("SIGTERM", () => { server.stop(); process.exit(0); });
      server.listen().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        server.stop();
        process.exitCode = 1;
      });
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}`);
    process.exitCode = 1;
  }
}

export { MockCameraServer, isSafeVirtualPath, parseArgs };
