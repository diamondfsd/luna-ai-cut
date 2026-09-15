import { Buffer } from "node:buffer";
import { ProtocolError, i16le, parseSubscription, putU16le, putU32le, u16le, u32le } from "./protocol.js";

const FPS = new Map([[1, 24], [2, 25], [3, 30], [4, 48], [5, 50], [6, 60], [7, 120], [8, 240], [10, 100], [11, 96], [29, 15]]);
const ISO_VALUES = new Map([[0, 0], [2, 50], [3, 100], [4, 200], [5, 400], [6, 800], [7, 1600], [8, 3200], [9, 6400], [10, 12800], [11, 25600]]);
const ALL_VIDEO = [1, 2, 3, 4, 5, 6].map((fps) => [0x10, fps]);

export const SUBSCRIPTION_KEYS = Object.freeze([
  "camcap_mode_profile", "camcap_video_format", "camcap_fov", "camcap_iso",
  "camcap_shutter", "camcap_photo_storage_format", "camcap_color_mode", "cam_storage",
  "cam_status", "timecode_info", "cam_expo_param", "cam_video_param_v2",
  "cam_record_time", "cam_image_effect", "cam_lens_state", "cam_fov",
  "cam_audio_status_v2",
]);

const PROFILES = {
  pocket4pro: {
    name: "Osmo Pocket 4 Pro",
    receiver: 0x08,
    tcpPoke: true,
    colors: [0x3f, 0x3c, 0x17, 0x41],
    formats: [...ALL_VIDEO, [0x0a, 6], [0x0a, 5], [0x0a, 4], [0x0a, 3], [0x0a, 2], [0x0a, 1]],
    dspLength: 26,
    internalStorage: true,
    hasGimbal: true,
    supportsFocus: true,
    modes: [0x00, 0x01, 0x02, 0x0a, 0x17, 0x28],
  },
  pocket4: {
    name: "Osmo Pocket 4",
    receiver: 0x08,
    tcpPoke: true,
    colors: [0x3f, 0x3c, 0x17],
    formats: [...ALL_VIDEO, [0x0a, 6], [0x0a, 5], [0x0a, 4], [0x0a, 3], [0x0a, 2], [0x0a, 1]],
    dspLength: 26,
    internalStorage: true,
    hasGimbal: true,
    supportsFocus: true,
    modes: [0x00, 0x01, 0x02, 0x0a, 0x17, 0x28],
  },
  pocket3: {
    name: "Osmo Pocket 3",
    receiver: 0x08,
    tcpPoke: true,
    colors: [0x00, 0x3c, 0x3d],
    formats: [0x0a, 0x2d, 0x10].flatMap((resolution) => [1, 2, 3, 4, 5, 6].map((fps) => [resolution, fps])),
    dspLength: 27,
    internalStorage: false,
    hasGimbal: true,
    supportsFocus: true,
    modes: [0x00, 0x01, 0x02, 0x0a, 0x17, 0x28],
  },
  nano: {
    name: "Osmo Nano",
    receiver: 0x41,
    tcpPoke: false,
    colors: [0x00, 0x3f, 0x3d],
    formats: [...ALL_VIDEO],
    dspLength: 26,
    internalStorage: false,
    hasGimbal: false,
    supportsFocus: false,
    modes: [0x00, 0x01, 0x02, 0x05, 0x0a],
  },
};

const OPCODES = {
  "00/2b": "sessionWake",
  "00/26": "mediaList",
  "00/27": "mediaChunk",
  "00/28": "mediaDelete",
  "00/81": "register",
  "00/88": "presence",
  "00/99": "subscribe",
  "02/01": "photo",
  "02/02": "record",
  "02/09": "nanoGate",
  "02/0c": "playback",
  "02/18": "videoFormat",
  "02/1e": "expoMode",
  "02/22": "aeMeter",
  "02/24": "focusMode",
  "02/28": "shutter",
  "02/2a": "iso",
  "02/2c": "whiteBalance",
  "02/2e": "ev",
  "02/30": "focusPoint",
  "02/32": "aeRegion",
  "02/42": "color",
  "02/68": "livePrepare",
  "02/80": "status",
  "02/8e": "param",
  "02/9f": "audioDspSet",
  "02/a0": "audioDspGet",
  "02/a5": "trackingPoll",
  "02/a6": "trackingBox",
  "02/a8": "unknown",
  "02/b8": "zoom",
  "02/bf": "favorite",
  "02/dc": "storage",
  "02/e1": "shootingMode",
  "04/01": "gimbalStick",
  "04/05": "gimbalAttitude",
  "04/14": "gimbalTimedAngle",
  "04/27": "gimbalFace",
  "04/4c": "gimbalCommand",
  "04/50": "gimbalParams",
  "03/da": "gimbalInit",
  "07/07": "wifiSsid",
  "07/0e": "wifiPassword",
  "07/39": "wifiWorkMode",
  "07/45": "pairingPin",
  "07/46": "pairApproval",
  "07/47": "joinWifi",
  "07/48": "stationMode",
  "07/ab": "wifiScan",
  "08/78": "streamConfig",
  "08/8e": "streaming",
  "08/e1": "multicamMode",
  "09/a8": "liveEnable",
  "53/10": "sessionWake",
};

function keyFor(frame) {
  return `${frame.cmdSet.toString(16).padStart(2, "0")}/${frame.cmdId.toString(16).padStart(2, "0")}`;
}

function allZero(buffer) {
  return buffer.every((value) => value === 0);
}

function validFloat(buffer, offset) {
  if (offset + 4 > buffer.length) return false;
  const value = buffer.readFloatLE(offset);
  return Number.isFinite(value);
}

function makeGlamour(enabled = false) {
  const blob = Buffer.alloc(62);
  blob[5] = enabled ? 1 : 0;
  return blob;
}

function makeDsp(length, raw = 0x18) {
  const blob = Buffer.alloc(length);
  blob[2] = raw;
  return blob;
}

export function profileFor(name = "pocket4pro") {
  const normalized = String(name).toLowerCase().replace(/[ -]/g, "");
  const profile = PROFILES[normalized];
  if (!profile) throw new Error(`unknown mock model ${name}; use pocket4pro, pocket4, pocket3, or nano`);
  return { id: normalized, ...profile };
}

export class MockCameraState {
  constructor(options = {}) {
    this.profile = profileFor(options.model);
    this.deviceName = options.deviceName || this.profile.name;
    this.ssid = options.ssid || "OPC-MOCK-P4P";
    this.wifiPassword = options.wifiPassword || "mock-password";
    this.firmware = options.firmware || "01.00.00.00";
    this.paired = options.paired !== false;
    this.recording = false;
    this.recordingStartedAt = null;
    this.inPlayback = false;
    this.liveEnabled = false;
    this.stationMode = false;
    this.streaming = false;
    this.shootingMode = 0x01;
    this.expoMode = 0x01;
    this.shutterDenom = 50;
    this.isoIndex = 3;
    this.isoLimit = 0x07;
    this.ev = 0x10;
    this.color = this.profile.colors[0];
    this.fov = 0x01;
    this.focusMode = 0x01;
    this.focusTrack = 0x00;
    this.wbMode = 0x00;
    this.wbKelvin = 5600;
    this.wbTint = 0;
    this.audioChannel = 0x02;
    this.vocalBoost = 0x00;
    this.selfieFlip = 0x00;
    this.glamour = makeGlamour(false);
    this.audioDsp = makeDsp(this.profile.dspLength);
    this.videoResolution = this.profile.formats[0][0];
    this.videoFpsIndex = this.profile.formats[0][1];
    this.focusX = 0.5;
    this.focusY = 0.5;
    this.tracking = false;
    this.trackingBox = null;
    this.zoomLens = 217;
    this.gimbal = {
      yaw: 0,
      pitch: 0,
      tiltLock: 0,
      speed: 1,
      face: 0,
      modeFamily: 2,
      axis0: 1024,
      axis1: 1024,
    };
    this.batteryPercent = 83;
    this.batteryMilliVolts = 3900;
    this.batteryMilliAmps = -420;
    this.charging = false;
    this.docked = false;
    this.sdTotalMb = 128000;
    this.sdFreeMb = 96000;
    this.internalTotalMb = this.profile.internalStorage ? 32000 : 0;
    this.internalFreeMb = this.profile.internalStorage ? 24000 : 0;
    this.subscriptions = new Map();
    this.media = options.media || defaultMedia(this.profile);
    this.nextMediaCounter = 10;
  }

  validate(frame) {
    const key = keyFor(frame);
    const name = OPCODES[key];
    if (!name) return { ok: false, code: 0xe0, reason: `unsupported opcode ${key}` };
    try {
      switch (key) {
        case "07/45": {
          if (frame.payload.length < 2) throw new ProtocolError("pairing PIN payload is empty", "PAIRING_LENGTH");
          const identifier = readPacked(frame.payload, 0);
          const pin = readPacked(frame.payload, identifier.next);
          if (!identifier.value || !pin.value || pin.value.length > 63 || pin.next !== frame.payload.length) throw new ProtocolError("invalid pairing strings", "PAIRING_VALUE");
          break;
        }
        case "00/2b":
          if (!frame.payload.equals(Buffer.from([4, 0])) && !frame.payload.equals(Buffer.from([1, 1]))) throw new ProtocolError("session wake must be 04 00 or 01 01", "SESSION_WAKE_VALUE");
          break;
        case "00/81":
          if (
            frame.payload.length !== 62 || frame.payload[0] !== 0x00
            || !frame.payload.subarray(1, 4).equals(Buffer.from("APP", "ascii"))
            || frame.payload[41] !== 0x02 || frame.payload[50] !== 0x02 || frame.payload[51] !== 0x08
          ) throw new ProtocolError("register payload is not the captured APP identity", "REGISTER_VALUE");
          break;
        case "00/88":
          if (!frame.payload.equals(Buffer.from([0x17, 0x00, 0x46, 0x23, 0x7c, 0x41, 0x50, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02]))) throw new ProtocolError("presence payload is not the captured APP identity", "PRESENCE_VALUE");
          break;
        case "00/99": {
          const subscription = parseSubscription(frame.payload);
          if (!SUBSCRIPTION_KEYS.includes(subscription.name)) throw new ProtocolError(`unsupported subscription ${subscription.name}`, "UNSUPPORTED");
          break;
        }
        case "00/26":
          if (![14, 42].includes(frame.payload.length) || frame.payload[0] !== 0x4a) throw new ProtocolError("invalid media list request", "MEDIA_LIST_LENGTH");
          if (frame.payload[1] === 0x00) {
            if (![1, 2].includes(frame.payload[4])) throw new ProtocolError("invalid media list counter", "MEDIA_LIST_COUNTER");
          } else if (!(frame.payload[1] === 0x04 && frame.payload[2] === 0x0e && frame.payload[3] === 0x10)) {
            throw new ProtocolError("unknown media list subcommand", "MEDIA_LIST_VERB");
          }
          break;
        case "00/28":
          if (frame.payload.length !== 18 || frame.payload[0] !== 1 || frame.payload[9] !== 0 || frame.payload[10] !== 1 || frame.payload[11] !== 1 || frame.payload[12] !== 0 || frame.payload[13] !== 0 || frame.payload[14] !== 0 || frame.payload[15] !== 0 || frame.payload[16] !== 0 || frame.payload[17] !== 0) throw new ProtocolError("invalid delete payload", "MEDIA_DELETE_LENGTH");
          if (!this.media.some((file) => file.handle === u32le(frame.payload, 1))) throw new ProtocolError("media handle does not exist", "MEDIA_STATE");
          break;
        case "02/0c":
          if (!frame.payload.equals(Buffer.from([1, 1, 0, 0])) && !frame.payload.equals(Buffer.from([1, 1, 0, 1]))) throw new ProtocolError("playback payload must enter or exit", "PLAYBACK_VALUE");
          if (frame.payload[3] === 1 && this.recording) throw new ProtocolError("playback cannot start while recording", "PLAYBACK_STATE");
          if ((frame.payload[3] === 1 && this.inPlayback) || (frame.payload[3] === 0 && !this.inPlayback)) throw new ProtocolError("playback state does not allow this transition", "PLAYBACK_STATE");
          break;
        case "09/a8":
          if (frame.receiver !== this.profile.receiver || !frame.payload.equals(Buffer.from([0, 4, 2, 0, 0, 0, 0, 0, 0, 0]))) throw new ProtocolError(`live enable requires receiver 0x${this.profile.receiver.toString(16)} and the captured payload`, "LIVE_ENABLE_VALUE");
          if (this.inPlayback) throw new ProtocolError("live view cannot start during playback", "LIVE_STATE");
          break;
        case "02/09":
          if (this.profile.id !== "nano" || frame.payload.length !== 11 || ![3, 4].includes(frame.payload[10])) throw new ProtocolError("Nano live gate is only 11 bytes ending in 03 or 04", "NANO_GATE_VALUE");
          break;
        case "02/02":
          if (frame.payload.length !== 1 || ![0, 1].includes(frame.payload[0])) throw new ProtocolError("record payload must be 00 or 01", "RECORD_VALUE");
          if (this.inPlayback || (frame.payload[0] === 1 && this.recording) || (frame.payload[0] === 0 && !this.recording)) throw new ProtocolError("record state does not allow this transition", "RECORD_STATE");
          break;
        case "02/01":
          if (!frame.payload.equals(Buffer.from([1]))) throw new ProtocolError("photo payload must be 01", "PHOTO_VALUE");
          if (this.inPlayback || this.recording || !this.isPhotoMode()) throw new ProtocolError("photo is not available in the current camera state", "PHOTO_STATE");
          break;
        case "02/e1":
          if (frame.payload.length !== 1 || !this.profile.modes.includes(frame.payload[0])) throw new ProtocolError("shooting mode is not supported by this body", "MODE_VALUE");
          if (this.inPlayback || this.recording) throw new ProtocolError("shooting mode cannot change while recording or in playback", "MODE_STATE");
          break;
        case "08/e1":
          if (frame.payload.length !== 1 || ![1, 0x1a].includes(frame.payload[0])) throw new ProtocolError("multicam mode must be Video or livestream", "MULTICAM_MODE_VALUE");
          break;
        case "02/18":
          if (this.recording || this.inPlayback) throw new ProtocolError("video format cannot change while recording or in playback", "VIDEO_FORMAT_STATE");
          if (frame.payload.length !== 5 || frame.payload[2] !== 0 || frame.payload[3] !== 0 || frame.payload[4] !== 0 || !this.profile.formats.some(([r, f]) => r === frame.payload[0] && f === frame.payload[1])) throw new ProtocolError("resolution/fps pair is not advertised by this body", "VIDEO_FORMAT_VALUE");
          break;
        case "02/1e":
          if (!frame.payload.equals(Buffer.from([1, 0])) && !frame.payload.equals(Buffer.from([4, 0]))) throw new ProtocolError("exposure mode must be 01 00 or 04 00", "EXPO_VALUE");
          break;
        case "02/28": {
          if (frame.payload.length !== 7 || frame.payload[0] !== 1 || frame.payload[3] !== 0 || frame.payload[4] !== 0 || frame.payload[5] !== 0 || frame.payload[6] !== 0x40) throw new ProtocolError("invalid shutter payload", "SHUTTER_LENGTH");
          const raw = u16le(frame.payload, 1);
          if (!(raw & 0x8000) || raw === 0x8000 || (raw & 0x7fff) > 16000) throw new ProtocolError("shutter must be an encoded 1/N value", "SHUTTER_VALUE");
          break;
        }
        case "02/2a":
          if (frame.payload.length !== 1 || !ISO_VALUES.has(frame.payload[0])) throw new ProtocolError("ISO index is not supported", "ISO_VALUE");
          break;
        case "02/42":
          if (frame.payload.length !== 1 || !this.profile.colors.includes(frame.payload[0])) throw new ProtocolError("color mode is not supported by this body", "COLOR_VALUE");
          break;
        case "02/24":
          if (!this.profile.supportsFocus) throw new ProtocolError("this profile has no camera focus", "UNSUPPORTED");
          if (frame.payload.length !== 1 || ![1, 2].includes(frame.payload[0])) throw new ProtocolError("focus mode must be 01 or 02", "FOCUS_VALUE");
          break;
        case "02/2c": {
          if (frame.payload.length !== 5 || ![0, 6].includes(frame.payload[0])) throw new ProtocolError("white-balance mode must be 00 or 06", "WB_MODE");
          const kelvinHundreds = u16le(frame.payload, 1);
          const tint = frame.payload.readInt16LE(3);
          if (frame.payload[0] === 6 && (kelvinHundreds < 20 || kelvinHundreds > 100)) throw new ProtocolError("custom white-balance kelvin is outside 2000..10000", "WB_KELVIN");
          if (tint < -100 || tint > 100) throw new ProtocolError("white-balance tint is outside -100..100", "WB_TINT");
          break;
        }
        case "02/2e":
          if (frame.payload.length !== 1 || frame.payload[0] < 7 || frame.payload[0] > 0x19) throw new ProtocolError("EV is outside -3..+3", "EV_VALUE");
          break;
        case "02/22":
          if (!this.profile.supportsFocus) throw new ProtocolError("this profile has no camera focus", "UNSUPPORTED");
          if (!frame.payload.equals(Buffer.from([2]))) throw new ProtocolError("AE meter hint must be 02", "AE_METER_VALUE");
          break;
        case "02/30":
          if (!this.profile.supportsFocus) throw new ProtocolError("this profile has no camera focus", "UNSUPPORTED");
          if (frame.payload.length !== 21 || !validFloat(frame.payload, 0) || !validFloat(frame.payload, 4) || frame.payload.readFloatLE(0) < 0 || frame.payload.readFloatLE(0) > 1 || frame.payload.readFloatLE(4) < 0 || frame.payload.readFloatLE(4) > 1 || frame.payload.subarray(8).some((value) => value !== 0)) throw new ProtocolError("focus point must contain normalized x/y and zero reserved bytes", "FOCUS_POINT_VALUE");
          break;
        case "02/32":
          if (!this.profile.supportsFocus) throw new ProtocolError("this profile has no camera focus", "UNSUPPORTED");
          if (frame.payload.length !== 20 || !frame.payload.subarray(0, 4).equals(Buffer.from([0, 2, 1, 0])) || !validFloat(frame.payload, 4) || !validFloat(frame.payload, 8) || frame.payload.readFloatLE(4) < 0 || frame.payload.readFloatLE(4) > 1 || frame.payload.readFloatLE(8) < 0 || frame.payload.readFloatLE(8) > 1 || frame.payload.subarray(12).some((value) => value !== 0)) throw new ProtocolError("AE region must contain normalized x/y and the captured reserved bytes", "AE_REGION_VALUE");
          break;
        case "02/68":
          if (this.profile.id === "nano") throw new ProtocolError("Nano does not use the Pocket live preparation command", "UNSUPPORTED");
          if (!frame.payload.equals(Buffer.from([8]))) throw new ProtocolError("live prepare must be 08", "LIVE_PREPARE_VALUE");
          break;
        case "02/8e":
          if (frame.payload.equals(Buffer.from([1, 1, 0x1a, 0, 1, 1])) || frame.payload.equals(Buffer.from([1, 1, 0x1a, 0, 1, 2]))) break;
          this.validateParam(frame.payload);
          break;
        case "02/9f":
          if (frame.payload.length !== this.profile.dspLength) throw new ProtocolError(`audio DSP blob must be ${this.profile.dspLength} bytes for ${this.profile.id}`, "DSP_LENGTH");
          break;
        case "02/a0":
          if (frame.payload.length !== 0) throw new ProtocolError("audio DSP GET has no payload", "DSP_GET_VALUE");
          break;
        case "02/a5":
          if (!frame.payload.equals(Buffer.from([0]))) throw new ProtocolError("tracking poll must be 00", "TRACKING_POLL_VALUE");
          break;
        case "02/a6":
          this.validateTracking(frame.payload);
          break;
        case "02/b8":
          this.validateZoom(frame.payload);
          break;
        case "02/bf":
          if (frame.payload.length !== 15 || frame.payload[0] !== 1 || frame.payload[1] !== 1 || frame.payload[10] !== 0 || ![0, 1].includes(frame.payload[11]) || frame.payload[12] !== 0 || frame.payload[13] !== 0 || frame.payload[14] !== 0) throw new ProtocolError("invalid favorite payload", "FAVORITE_VALUE");
          if (!this.media.some((file) => file.handle === u32le(frame.payload, 2))) throw new ProtocolError("media handle does not exist", "MEDIA_STATE");
          break;
        case "04/01":
          if (!this.profile.hasGimbal) throw new ProtocolError("this profile has no gimbal", "UNSUPPORTED");
          if (frame.payload.length !== 10 || u16le(frame.payload, 0) < 474 || u16le(frame.payload, 0) > 1574 || frame.payload[2] !== 0 || frame.payload[3] !== 0 || u16le(frame.payload, 4) < 474 || u16le(frame.payload, 4) > 1574 || !frame.payload.subarray(6).equals(Buffer.from([0, 0x80, 0x22, 0]))) throw new ProtocolError("invalid gimbal stick payload", "GIMBAL_STICK_VALUE");
          break;
        case "04/14":
          if (!this.profile.hasGimbal) throw new ProtocolError("this profile has no gimbal", "UNSUPPORTED");
          if (frame.payload.length !== 8 || frame.payload[2] !== 0 || frame.payload[3] !== 0 || ![4, 5].includes(frame.payload[6]) || frame.payload[7] < 1) throw new ProtocolError("invalid timed gimbal payload", "GIMBAL_ANGLE_VALUE");
          if (frame.payload[6] === 4 && (i16le(frame.payload, 0) !== 0 || i16le(frame.payload, 4) !== 0)) throw new ProtocolError("timed gimbal stop must use zero angles", "GIMBAL_ANGLE_VALUE");
          if (frame.payload[6] === 5 && (i16le(frame.payload, 0) < -480 || i16le(frame.payload, 0) > 2250 || i16le(frame.payload, 4) < -1800 || i16le(frame.payload, 4) > 1800)) throw new ProtocolError("timed gimbal angle is outside the captured reach", "GIMBAL_ANGLE_VALUE");
          break;
        case "04/4c":
          if (!this.profile.hasGimbal) throw new ProtocolError("this profile has no gimbal", "UNSUPPORTED");
          if (![[0xfe, 8], [0xfe, 9], [2, 8], [1, 8], [0, 8]].some((pair) => frame.payload.equals(Buffer.from(pair)))) throw new ProtocolError("unknown gimbal command", "GIMBAL_COMMAND_VALUE");
          break;
        case "04/50":
          if (!this.profile.hasGimbal) throw new ProtocolError("this profile has no gimbal", "UNSUPPORTED");
          if (!frame.payload.equals(Buffer.from([1, 4, 5])) && !(frame.payload.length === 4 && frame.payload[0] === 0 && [4, 5].includes(frame.payload[1]) && frame.payload[2] === 1 && frame.payload[3] <= 2)) throw new ProtocolError("invalid gimbal params payload", "GIMBAL_PARAMS_VALUE");
          break;
        case "03/da":
          if (!this.profile.hasGimbal) throw new ProtocolError("this profile has no gimbal", "UNSUPPORTED");
          if (!frame.payload.equals(Buffer.from([5, 0xff, 0xff, 0xff, 0xff]))) throw new ProtocolError("invalid gimbal init payload", "GIMBAL_INIT_VALUE");
          break;
        case "07/07":
        case "07/0e":
          if (frame.payload.length !== 0) throw new ProtocolError("Wi-Fi getter must be empty", "WIFI_GET_VALUE");
          break;
        case "07/39":
          if (!frame.payload.equals(Buffer.from([0]))) throw new ProtocolError("Wi-Fi work-mode request must be 00", "WIFI_MODE_VALUE");
          break;
        case "07/ab":
          if (frame.payload.length !== 0) throw new ProtocolError("Wi-Fi mode/scan request must be empty", "WIFI_REQUEST_VALUE");
          break;
        case "07/46":
          if (!frame.payload.equals(Buffer.from([0]))) throw new ProtocolError("pair approval ACK must be 00", "PAIR_APPROVAL_VALUE");
          break;
        case "07/47": {
          const ssid = readPacked(frame.payload, 0);
          const password = readPacked(frame.payload, ssid.next);
          if (!ssid.value || ssid.value.length > 32 || password.value.length > 63 || password.next !== frame.payload.length) throw new ProtocolError("invalid Wi-Fi join strings", "WIFI_JOIN_VALUE");
          break;
        }
        case "07/48":
          if (frame.payload.length !== 1 || ![0, 1].includes(frame.payload[0])) throw new ProtocolError("station mode must be 00 or 01", "STATION_MODE_VALUE");
          break;
        case "08/78":
          if (frame.payload.length < 14 || frame.payload[0] !== 1) throw new ProtocolError("stream configuration prefix is invalid", "STREAM_CONFIG_VALUE");
          break;
        case "08/8e":
          if (!frame.payload.equals(Buffer.from([1, 1, 0x1a, 0, 1, 1])) && !frame.payload.equals(Buffer.from([1, 1, 0x1a, 0, 1, 2]))) throw new ProtocolError("streaming SET must enable or disable", "STREAMING_VALUE");
          break;
        case "53/10":
          if (!frame.payload.equals(Buffer.alloc(4))) throw new ProtocolError("invalid session wake payload", "SESSION_WAKE_VALUE");
          break;
        default:
          break;
      }
    } catch (error) {
      if (error instanceof ProtocolError) return { ok: false, code: error.code === "UNSUPPORTED" ? 0xe0 : error.code.includes("STATE") ? 0xd9 : 0xdf, reason: error.message };
      throw error;
    }
    return { ok: true, name };
  }

  isPhotoMode() {
    if (this.profile.id === "nano") return this.shootingMode === 0x05;
    return this.shootingMode === 0x17 || this.shootingMode === 0x28;
  }

  validateParam(payload) {
    if (payload.length < 4) throw new ProtocolError("param payload is too short", "PARAM_SHORT");
    const get = payload[0] === 0 && payload[1] === 1;
    const set = payload[0] === 1 && payload[1] === 1;
    if (!get && !set) throw new ProtocolError("param verb is not GET or SET", "PARAM_VERB");
    const pid = u16le(payload, 2);
    const supported = new Set([0x0009, 0x000f, 0x0020, 0x0038, 0x0039, 0x003b, 0x004c]);
    if (!supported.has(pid)) throw new ProtocolError(`param 0x${pid.toString(16).padStart(4, "0")} is not supported`, "UNSUPPORTED");
    if (get && payload.length !== 4) throw new ProtocolError("param GET must be 4 bytes", "PARAM_GET_LENGTH");
    if (set) {
      if (payload.length < 5 || payload.length !== 5 + payload[4]) throw new ProtocolError("param SET length mismatch", "PARAM_SET_LENGTH");
      const value = payload.subarray(5);
      if (pid === 0x0009 && ![0x01, 0x05].includes(value[0])) throw new ProtocolError("FOV must be Wide (01) or Natural Wide (05)", "FOV_VALUE");
      if (pid === 0x0038) throw new ProtocolError("selfie flip is camera-owned and cannot be SET", "UNSUPPORTED");
      if (pid === 0x0039 && value.length !== 62) throw new ProtocolError("glamour blob must be 62 bytes", "GLAMOUR_LENGTH");
      if (pid === 0x003b && (value.length !== 2 || value[0] !== 1 || value[1] > 3)) throw new ProtocolError("focus-track SET must be 01 00..03", "FOCUS_TRACK_VALUE");
      if ([0x000f, 0x0020, 0x004c].includes(pid) && value.length !== 1) throw new ProtocolError("scalar param SET must have one byte", "PARAM_VALUE_LENGTH");
      if (pid === 0x000f && ![2, 3, 4, 5, 6, 7, 8, 9].includes(value[0])) throw new ProtocolError("unsupported ISO ceiling", "ISO_LIMIT_VALUE");
      if (pid === 0x0020 && ![1, 2, 3].includes(value[0])) throw new ProtocolError("unsupported audio channel", "AUDIO_CHANNEL_VALUE");
      if (pid === 0x004c && ![0, 1].includes(value[0])) throw new ProtocolError("unsupported vocal boost value", "VOCAL_BOOST_VALUE");
    }
  }

  validateTracking(payload) {
    if (payload.length !== 21) throw new ProtocolError("tracking box must be 21 bytes", "TRACKING_LENGTH");
    if (allZero(payload)) return;
    if (payload[0] !== 1 || payload[1] !== 0 || payload[2] !== 0) throw new ProtocolError("tracking SET verb must be 01 00 00", "TRACKING_VERB");
    for (const offset of [5, 9, 13, 17]) if (!validFloat(payload, offset)) throw new ProtocolError("tracking box contains a non-finite float", "TRACKING_FLOAT");
    const values = [5, 9, 13, 17].map((offset) => payload.readFloatLE(offset));
    if (values.some((value) => value < 0 || value > 1) || values[2] <= 0 || values[3] <= 0) throw new ProtocolError("tracking box must be normalized and non-empty", "TRACKING_VALUE");
  }

  validateZoom(payload) {
    if (payload.length !== 4) throw new ProtocolError("zoom payload must be 4 bytes", "ZOOM_LENGTH");
    if (payload[0] === 0x0a && payload[1] === 0x4e) {
      const lens = u16le(payload, 2);
      const { min, max } = this.zoomLensBounds();
      if (lens < min || lens > max) throw new ProtocolError(`zoom lens position is outside ${min}..${max} for ${this.profile.id}`, "ZOOM_VALUE");
      if (this.color === 0x41) throw new ProtocolError("Pocket 4 Pro D-Log2 requires a D-Log hop before zoom", "ZOOM_STATE");
      return;
    }
    if (this.profile.id === "pocket3" && payload[0] === 1 && payload[3] === 0 && payload[1] >= 0x48 && payload[1] <= 0x4a && payload[2] <= 1) return;
    if (payload[0] === 3 && payload[1] === 0) return;
    if (payload.equals(Buffer.from([0xff, 0, 0, 0]))) return;
    throw new ProtocolError("unknown zoom subcommand", "ZOOM_VERB");
  }

  zoomLensBounds({ shootingMode = this.shootingMode, videoResolution = this.videoResolution } = {}) {
    if (this.profile.id === "nano") return { min: 217, max: 217 };
    if (this.profile.id === "pocket4pro") {
      return { min: 217, max: [0x00, 0x02, 0x28].includes(shootingMode) ? 651 : 2604 };
    }
    if (this.profile.id === "pocket4") return { min: 217, max: [0x00, 0x02, 0x28].includes(shootingMode) ? 217 : 868 };
    if ([0x00, 0x02, 0x28].includes(shootingMode)) return { min: 217, max: 217 };
    if (videoResolution === 0x10) return { min: 217, max: 434 };
    if (videoResolution === 0x2d) return { min: 217, max: 651 };
    return { min: 217, max: 868 };
  }

  apply(frame) {
    const key = keyFor(frame);
    switch (key) {
      case "07/45": this.paired = true; break;
      case "07/48": this.stationMode = frame.payload[0] === 1; break;
      case "08/8e": this.streaming = frame.payload[5] === 1; break;
      case "02/0c": this.inPlayback = frame.payload[3] === 1; if (this.inPlayback) this.liveEnabled = false; break;
      case "09/a8": this.liveEnabled = true; break;
      case "02/09": if (frame.payload[10] === 4) this.liveEnabled = false; break;
      case "02/02":
        if (frame.payload[0] === 1) {
          this.recording = true;
          this.recordingStartedAt = Date.now();
        } else {
          const durationSeconds = this.recordingElapsedSeconds();
          this.recording = false;
          this.recordingStartedAt = null;
          this.addCapturedMedia("MP4", durationSeconds);
        }
        break;
      case "02/01": this.addCapturedMedia("JPG", 0); break;
      case "02/e1": this.shootingMode = frame.payload[0]; break;
      case "08/e1": break;
      case "02/18": this.videoResolution = frame.payload[0]; this.videoFpsIndex = frame.payload[1]; break;
      case "02/1e": this.expoMode = frame.payload[0]; break;
      case "02/28": this.shutterDenom = u16le(frame.payload, 1) & 0x7fff; break;
      case "02/2a": this.isoIndex = frame.payload[0]; break;
      case "02/42": this.color = frame.payload[0]; break;
      case "02/24": this.focusMode = frame.payload[0]; break;
      case "02/2c": this.wbMode = frame.payload[0]; this.wbKelvin = u16le(frame.payload, 1) * 100 || this.wbKelvin; this.wbTint = frame.payload.readInt16LE(3); break;
      case "02/2e": this.ev = frame.payload[0]; break;
      case "02/30": this.focusX = frame.payload.readFloatLE(0); this.focusY = frame.payload.readFloatLE(4); break;
      case "02/32": this.focusX = frame.payload.readFloatLE(4); this.focusY = frame.payload.readFloatLE(8); break;
      case "02/8e":
        if (frame.payload[2] === 0x1a && frame.payload[3] === 0 && frame.payload.length === 6) this.streaming = frame.payload[5] === 1;
        else this.applyParam(frame.payload);
        break;
      case "02/9f": this.audioDsp = Buffer.from(frame.payload); break;
      case "02/a6": this.trackingBox = allZero(frame.payload) ? null : { id: frame.payload.readUInt16LE(3), x: frame.payload.readFloatLE(5), y: frame.payload.readFloatLE(9), width: frame.payload.readFloatLE(13), height: frame.payload.readFloatLE(17) }; this.tracking = Boolean(this.trackingBox); break;
      case "02/b8":
        if (frame.payload[0] === 0x0a) this.zoomLens = u16le(frame.payload, 2);
        else if (this.profile.id === "pocket3" && frame.payload[0] === 1) {
          const bounds = this.zoomLensBounds();
          this.zoomLens = frame.payload[2] === 1 ? bounds.max : bounds.min;
        } else if (frame.payload[0] === 3) {
          const bounds = this.zoomLensBounds();
          const delta = u16le(frame.payload, 2) === 100 ? 217 : -217;
          this.zoomLens = clamp(this.zoomLens + delta, bounds.min, bounds.max);
        }
        break;
      case "04/01": {
        const axis0 = u16le(frame.payload, 0);
        const axis1 = u16le(frame.payload, 4);
        this.gimbal.axis0 = axis0;
        this.gimbal.axis1 = axis1;
        // Stick values are velocities. A small deterministic integration keeps
        // attitude pushes useful to clients without pretending to be a motor model.
        this.gimbal.pitch = clamp(this.gimbal.pitch + (axis0 - 1024) / 550 * 1.2, -180, 180);
        this.gimbal.yaw = clamp(this.gimbal.yaw + (axis1 - 1024) / 550 * 1.2, -48, 225);
        break;
      }
      case "04/14": this.gimbal.yaw = i16le(frame.payload, 0) / 10; this.gimbal.pitch = i16le(frame.payload, 4) / 10; break;
      case "04/4c":
        if (frame.payload[0] === 0xfe && frame.payload[1] === 9) {
          this.gimbal.face = this.gimbal.face ? 0 : 1;
          this.gimbal.yaw = this.gimbal.face ? 180 : 0;
        }
        if (frame.payload[0] === 0xfe && frame.payload[1] === 8) {
          this.gimbal.yaw = 0;
          this.gimbal.pitch = 0;
        }
        if (frame.payload[0] === 2 && frame.payload[1] === 8) this.gimbal.modeFamily = 2;
        if (frame.payload[0] === 1 && frame.payload[1] === 8) this.gimbal.modeFamily = 1;
        if (frame.payload[0] === 0 && frame.payload[1] === 8) this.gimbal.modeFamily = 0;
        break;
      case "04/50": if (frame.payload[0] === 0) { if (frame.payload[1] === 4) this.gimbal.tiltLock = frame.payload[3]; if (frame.payload[1] === 5) this.gimbal.speed = frame.payload[3]; } break;
      case "00/28": this.media = this.media.filter((file) => file.handle !== u32le(frame.payload, 1)); break;
      case "02/bf": { const handle = u32le(frame.payload, 2); const item = this.media.find((file) => file.handle === handle); if (item) item.starred = frame.payload[11] === 1; break; }
      default: break;
    }
  }

  applyParam(payload) {
    const pid = u16le(payload, 2);
    const value = payload.subarray(5);
    if (payload[0] !== 1) return;
    if (pid === 0x0009) this.fov = value[0];
    if (pid === 0x000f) this.isoLimit = value[0];
    if (pid === 0x0020) this.audioChannel = value[0];
    if (pid === 0x0039) this.glamour = Buffer.from(value);
    if (pid === 0x003b) this.focusTrack = value[1];
    if (pid === 0x004c) this.vocalBoost = value[0];
  }

  paramValue(pid) {
    if (pid === 0x0009) return Buffer.from([this.fov]);
    if (pid === 0x000f) return Buffer.from([this.isoLimit]);
    if (pid === 0x0020) return Buffer.from([this.audioChannel]);
    if (pid === 0x0038) return Buffer.from([this.selfieFlip]);
    if (pid === 0x0039) return Buffer.from(this.glamour);
    if (pid === 0x003b) return Buffer.from([1, this.focusTrack]);
    if (pid === 0x004c) return Buffer.from([this.vocalBoost]);
    throw new ProtocolError(`unsupported param 0x${pid.toString(16)}`, "UNSUPPORTED");
  }

  recordingElapsedSeconds() {
    if (!this.recordingStartedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - this.recordingStartedAt) / 1000));
  }

  addCapturedMedia(extension, durationSeconds) {
    const sequence = this.nextMediaCounter;
    this.nextMediaCounter += 1;
    const serial = String(sequence).padStart(4, "0");
    const base = `DJI_202609131200${String(sequence).padStart(2, "0")}_${serial}_D`;
    const isPhoto = extension === "JPG";
    const file = {
      path: `DCIM/100MEDIA/${base}.${extension}`,
      thumbPath: `MISC/THM/100MEDIA/${base}.scr`,
      handle: 0x40000000 + sequence,
      sizeBytes: isPhoto ? 2048 : 4096,
      durationSeconds,
      starred: false,
      storage: this.profile.internalStorage ? 1 : 0,
      resolution: "3840x2160",
      fps: isPhoto ? 0 : 25,
    };
    this.media.push(file);
    const megabytes = Math.max(1, Math.ceil(file.sizeBytes / (1024 * 1024)));
    if (file.storage === 1) this.internalFreeMb = Math.max(0, this.internalFreeMb - megabytes);
    else this.sdFreeMb = Math.max(0, this.sdFreeMb - megabytes);
  }

  subscribedValue(name) {
    switch (name) {
      case "camcap_mode_profile": return Buffer.from([1, 1, 0, 1, this.shootingMode]);
      case "camcap_video_format": return encodeVideoCapabilities(this.profile.formats);
      case "camcap_fov": return Buffer.from([1, 4, 0, 0, 0, 0, 0]);
      case "camcap_iso": return encodeIsoCapabilities([...ISO_VALUES.keys()]);
      case "camcap_shutter": return encodeShutterCapabilities([16000, 8000, 4000, 2000, 1000, 500, 250, 125, 60, 50, 30, 25, 15, 8, 4]);
      case "camcap_photo_storage_format": return Buffer.from([1, 1, 0, 0]);
      case "camcap_color_mode": return encodeColorCapabilities(this.profile.colors);
      case "cam_storage": return Buffer.concat([putU32le(this.sdTotalMb), putU32le(this.sdFreeMb)]);
      case "cam_status": return Buffer.from([this.recording ? 1 : 0]);
      case "timecode_info": return timecodeValue();
      case "cam_expo_param": return this.expoValue();
      case "cam_video_param_v2": return Buffer.from([this.videoResolution, this.videoFpsIndex, 0, 0, 0]);
      case "cam_record_time": return putU32le(this.recordingElapsedSeconds());
      case "cam_image_effect": return this.imageEffectValue();
      case "cam_lens_state": return this.lensStateValue();
      case "cam_fov": return putU32le(this.zoomFactorRaw());
      case "cam_audio_status_v2": return audioStatusValue();
      default: return Buffer.alloc(0);
    }
  }

  expoValue() {
    const out = Buffer.alloc(20);
    out.writeUInt16LE(0x8000 | this.shutterDenom, 2);
    out[5] = this.isoIndex;
    out[6] = this.ev;
    out[7] = this.expoMode;
    out.writeUInt16LE(ISO_VALUES.get(this.isoIndex) || 100, 16);
    return out;
  }

  imageEffectValue() {
    const out = Buffer.alloc(12);
    out[2] = this.color;
    out[4] = this.wbMode;
    out.writeUInt16LE(this.wbMode === 0 ? 0 : Math.round(this.wbKelvin / 100), 5);
    out.writeInt16LE(this.wbTint, 7);
    return out;
  }

  zoomFactorRaw() {
    if (this.profile.id !== "pocket4pro") return 12287;
    if (this.zoomLens <= 651) {
      return Math.round(12287 - ((this.zoomLens - 217) * (12287 - 9368)) / (651 - 217));
    }
    return Math.round(9368 - ((this.zoomLens - 651) * (9368 - 2341)) / (2604 - 651));
  }

  lensStateValue() {
    const out = Buffer.alloc(67);
    out[0] = this.focusMode === 2 ? 0xb2 : 0xb1;
    out.writeFloatLE(this.focusX, 1);
    out.writeFloatLE(this.focusY, 5);
    out.writeUInt16LE(this.zoomLens, 14);
    return out;
  }

  statusFrames() {
    const storage = Buffer.alloc(this.profile.internalStorage ? 32 : 22);
    storage.writeUInt32LE(this.sdTotalMb, 6);
    storage.writeUInt32LE(this.sdFreeMb, 10);
    if (this.profile.internalStorage) {
      storage.writeUInt32LE(this.internalTotalMb, 24);
      storage.writeUInt32LE(this.internalFreeMb, 28);
    }
    const camera = Buffer.alloc(58);
    camera.writeUInt32LE((this.inPlayback ? 0x40000000 : 0) | (this.recording ? 0x80 : 0), 0);
    camera.writeUInt32LE(this.sdTotalMb, 5);
    camera.writeUInt32LE(this.sdFreeMb, 9);
    camera.writeUInt32LE(this.recording ? Math.max(1, 900 - this.recordingElapsedSeconds()) : 0, 17);
    camera.writeUInt16LE(this.recordingElapsedSeconds(), 29);
    camera[57] = this.shootingMode;
    const battery = Buffer.alloc(34);
    battery.writeUInt16LE(this.batteryMilliVolts, 1);
    battery.writeInt32LE(this.batteryMilliAmps, 5);
    battery[20] = this.batteryPercent;
    battery[27] = this.docked ? 1 : 0;
    battery[32] = this.charging ? 1 : 0;
    const frames = [
      { cmdSet: 0x02, cmdId: 0xdc, payload: storage, flags: 0 },
      { cmdSet: 0x02, cmdId: 0x80, payload: camera, flags: 0 },
      { cmdSet: 0x0d, cmdId: 0x02, payload: battery, flags: 0 },
    ];
    if (this.profile.hasGimbal) {
      const attitude = Buffer.alloc(50);
      attitude[6] = (this.gimbal.modeFamily & 0x03) << 6;
      attitude.writeInt16LE(Math.round(this.gimbal.yaw * 10), 4);
      attitude.writeInt16LE(Math.round(-this.gimbal.pitch * 10), 20);
      const face = Buffer.from([0, 0, this.gimbal.face ? 0x40 : 0]);
      frames.push(
        { cmdSet: 0x04, cmdId: 0x05, payload: attitude, flags: 0 },
        { cmdSet: 0x04, cmdId: 0x27, payload: face, flags: 0 },
      );
    }
    return frames;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function readPacked(data, offset) {
  if (offset >= data.length) throw new ProtocolError("packed string missing", "PAIRING_STRING");
  const length = data[offset];
  if (offset + 1 + length > data.length) throw new ProtocolError("packed string truncated", "PAIRING_STRING");
  return { value: data.subarray(offset + 1, offset + 1 + length).toString("utf8"), next: offset + 1 + length };
}

function encodeVideoCapabilities(formats) {
  const body = Buffer.alloc(1 + formats.length * 3);
  body[0] = formats.length;
  formats.forEach(([resolution, fps], index) => { body[1 + index * 3] = resolution; body[2 + index * 3] = fps; });
  return Buffer.concat([Buffer.from([1]), putU16le(body.length), body]);
}

function encodeIsoCapabilities(indices) {
  const body = Buffer.concat([Buffer.from([0, indices.length]), Buffer.from(indices)]);
  return Buffer.concat([Buffer.from([1]), putU16le(body.length), body]);
}

function encodeColorCapabilities(colors) {
  const body = Buffer.concat([Buffer.from([colors.length]), Buffer.from(colors)]);
  return Buffer.concat([Buffer.from([1]), putU16le(body.length), body]);
}

function encodeShutterCapabilities(denoms) {
  const body = Buffer.alloc(10 + denoms.length * 3);
  body[9] = denoms.length;
  denoms.forEach((denom, index) => { body.writeUInt16LE(0x8000 | denom, 10 + index * 3); });
  return Buffer.concat([Buffer.from([1]), putU16le(body.length), body]);
}

function timecodeValue() {
  const elapsed = Math.floor((Date.now() / 1000) % 3600);
  return Buffer.from([0, 0, 0, Math.floor(elapsed / 3600), Math.floor((elapsed % 3600) / 60), elapsed % 60, 0, 0]);
}

function audioStatusValue() {
  const out = Buffer.alloc(114);
  out.writeUInt16BE(5, 2);
  out.writeUInt16BE(5, 6);
  out.writeUInt16BE(4, 8);
  out.writeUInt16BE(100, 10);
  out.writeUInt16BE(100, 12);
  return out;
}

function defaultMedia(profile) {
  const files = [];
  for (let sequence = 1; sequence <= 3; sequence += 1) {
    const serial = String(sequence).padStart(4, "0");
    const base = `DJI_202609131200${String(sequence).padStart(2, "0")}_${serial}_D`;
    files.push({
      path: `DCIM/100MEDIA/${base}.MP4`,
      thumbPath: `MISC/THM/100MEDIA/${base}.scr`,
      handle: 0x40000000 + sequence,
      sizeBytes: 1024,
      durationSeconds: 12,
      starred: sequence === 1,
      storage: profile.internalStorage ? 1 : 0,
      resolution: "3840x2160",
      fps: 25,
    });
  }
  return files;
}

export function mediaManifest(files) {
  const records = files.map((file) => {
    const base = file.path.split("/").pop().replace(/\.[^.]+$/, "");
    const record = [];
    const marker = Buffer.alloc(16);
    marker.writeUInt32LE(file.sizeBytes >>> 0, 0);
    marker.writeUInt32LE(file.handle >>> 0, 4);
    marker.writeUInt16LE(file.durationSeconds, 8);
    marker[10] = 0;
    marker[11] = file.resolution === "1920x1080" ? 0x0a : 0x10;
    marker[12] = 0x03;
    marker[13] = file.starred ? 0xff : 0xfe;
    marker[14] = 0x19;
    marker[15] = 0x06;
    // The clients use the previous media-path end as the next record's lower bound.
    // Put each marker before its own path so that those overlapping scan windows still
    // resolve the correct handle.
    record.push(...marker);
    record.push(0, 0, 0, 0, 0, 0, file.starred ? 1 : 0);
    record.push(0x1a, (6 + Buffer.byteLength(file.path.replace(/\.[^.]+$/, ""))) & 0xff, 0, 0, 0, 1, ...Buffer.from(file.path.replace(/\.[^.]+$/, "")));
    record.push(0x1a, (6 + Buffer.byteLength(file.thumbPath.replace(/\.scr$/, ""))) & 0xff, 0, 0, 0, 2, ...Buffer.from(file.thumbPath.replace(/\.scr$/, "")));
    const extension = (file.path.split(".").pop() || "MP4").toUpperCase();
    const ext = `\x0d${String.fromCharCode(base.length + extension.length + 1)}${base}.${extension}`;
    record.push(...Buffer.from(ext, "latin1"));
    const fps = Buffer.alloc(8);
    fps.writeUInt32LE((file.fps || 25) * 1000, 0);
    fps.writeUInt32LE(1000, 4);
    record.push(...fps);
    return Buffer.from(record);
  });
  return Buffer.concat([putU32le(files.length), ...records]);
}
