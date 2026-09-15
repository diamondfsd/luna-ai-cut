# OpenPocketCine Node camera mock

Dependency-free Node `>=18` mock for the DJI Osmo DUML/SoftAP surfaces used by
OpenPocketCine. It is intended for protocol migration tests: a client can run
against a deterministic camera model before connecting to physical hardware.

## Start

From the repository root:

```sh
npm start --prefix tools/opc-mock-camera
```

Defaults:

| Surface | Address | Purpose |
|---|---|---|
| UDP | `127.0.0.1:9004` | DUML datalink, handshake, ACKs, commands, status and media chunks |
| TCP | `127.0.0.1:7001` | Pocket pairing poke and framed DUML request/reply |
| HTTP | `127.0.0.1:18080` | `/v2` media files and mock control endpoints |

For a phone or another machine, bind to a LAN address or `0.0.0.0`:

```sh
node tools/opc-mock-camera/server.js \
  --host 0.0.0.0 \
  --model pocket4pro \
  --udp-port 9004 \
  --tcp-port 7001 \
  --http-port 80
```

The client must support injecting the mock host and ports. The current app's
physical-camera path assumes `192.168.2.1`; it also obtains Wi-Fi credentials
and pairing approval through BLE, which this Node service does not emulate.
For a migrated app, bypass BLE for the mock and connect its UDP/TCP/HTTP
clients directly to the mock address.

Available models are `pocket4pro`, `pocket4`, `pocket3`, and `nano`. The model
changes receiver routing, color/format capabilities, DSP length, storage, and
gimbal behavior.

## Protocol coverage

The server implements the current app path for:

- DUML CRC8/CRC16 framing, TCP stream reassembly, UDP transport header/XOR,
  handshake, same-session UDP port rebind, routing header, ACK window and
  response packets.
- Registration, presence, subscriptions and status pushes.
- Record/photo/mode, exposure, ISO, shutter, white balance, focus, zoom,
  FOV, tracking, audio parameters, gimbal commands, playback and live-view enable.
- Pocket live enable `0x09/0xa8` with receiver `0x08`; Nano live gate
  `0x02/0x09` plus `0x09/0xa8` receiver `0x41`.
- Media list `0x00/0x26` and chunked CompositePack `0x00/0x27`, delete and
  favorite, HTTP Range, thumbnails, and LRF/XRF paths.
- Optional video packets from a newline-delimited hex Annex-B access-unit
  file.

Command payloads are validated before state mutation. Strict protocol mode is
enabled by default and models the camera as a stateful peer, not a stateless
packet echo service. Use `--permissive` only when probing a migrated client
whose startup order is not complete yet; payload and model capability checks
still apply in that mode.

## Strict contract

The default Pocket startup sequence is enforced per UDP session:

```text
handshake -> 00/81 register -> 00/88 presence -> 03/da gimbal init
          -> 00/99 subscriptions -> 02/68 live prepare -> 09/a8 live enable
```

The model also enforces:

- UDP transport sequence (+8), command counter (+1), DUML sequence (+1),
  routing header values, and the ACK window shape.
- One registration and one gimbal initialization per handshake, sequential
  subscription IDs, and a 5-second presence lease by default.
- Pocket/Nano-specific live-view preparation, live view versus playback,
  recording versus playback, and SD list -> trigger -> internal list order.
- Existing media handles for delete/favorite operations and advertised model
  capabilities for formats, colors, gimbal, DSP, and Nano commands.
- TCP pairing as the first valid command on a connection; exact retransmits
  are idempotent and replay the original response.

Invalid traffic is handled as follows:

| Condition | Behavior |
|---|---|
| Bad DUML CRC, transport header, routing field, packet sequence, or ACK structure | Drop without response |
| Well-formed ACK with an older cursor | Ignore as a stale ACK; it does not change state or command-order metrics |
| Malformed or unsupported parameter value | Reply with refusal payload `df` |
| Valid payload but invalid lifecycle/state/order | Reply with refusal payload `d9` |
| Unknown opcode or unsupported model command | Reply with refusal payload `e0` |
| Exact duplicate packet | Do not mutate state; replay its response when ACKs are enabled |

Every command is validated before `MockCameraState.apply()` runs. A rejected
command therefore cannot partially change camera state. The HTTP control
`patch` action uses the same rule and also rejects impossible combinations such
as recording plus playback, live view plus playback, or free storage larger
than total storage. `/control` `reset` resets the device state and invalidates
all active UDP/TCP sessions.

## Video source

Pass a text file with one complete Annex-B access unit per line. Whitespace is
ignored and a trailing `#` comment is allowed:

```text
00 00 00 01 67 ...
00 00 00 01 68 ...
00 00 00 01 65 ...
```

The service fragments each access unit into UDP `pktType=0x02` packets. The
source must contain decoder-compatible AVC/HEVC data; the mock does not encode
video.

## Media root

Without `--media-root`, catalogued media returns small deterministic placeholder
bytes and `.scr` thumbnails return a 1x1 JPEG. To serve real test files, use
the same relative paths as the catalog:

```text
media-root/
  DCIM/100MEDIA/DJI_20260913120001_0001_D.MP4
```

Use `/state` to see the exact catalog paths. `/v2` requires both `storage=0|1`
and a catalogued relative `path`, and supports `Range: bytes=start-end` and
suffix ranges.

## Inspect and control

```sh
curl http://127.0.0.1:18080/health
curl http://127.0.0.1:18080/state

curl -X POST http://127.0.0.1:18080/control \
  -H 'content-type: application/json' \
  -d '{"action":"patch","patch":{"batteryPercent":42,"recording":false}}'

curl -X POST http://127.0.0.1:18080/control \
  -H 'content-type: application/json' \
  -d '{"action":"fault","name":"dropVideo","value":true}'
```

Control actions are `reset`, `patch`, and `fault`. Patch fields are validated;
fault names are `dropHandshake`, `dropAcks`, `dropVideo`, and
`responseDelayMs`. Use `--json-log` for newline-delimited machine-readable
traffic logs.

`/health` returns the live counters, including `acceptedCommands`,
`rejectedCommands`, `stateRejected`, `parameterRejected`,
`unsupportedCommands`, `droppedPackets`, `malformedPackets`,
`outOfOrderPackets`, `staleAcks`, and `duplicatePackets`. This makes a migrated APP's
protocol test observable without reading process logs.

## Use as a Node module

The package has no runtime dependencies and can be copied or installed into a
different Node project:

```js
import { MockCameraServer } from "@openpocketcine/mock-camera";

const mock = new MockCameraServer({
  host: "127.0.0.1",
  udpPort: 9004,
  tcpPort: 7001,
  httpPort: 18080,
  model: "pocket4pro",
  log: "json",
});

await mock.listen();
// Run the client under test, then:
// mock.stop();
```

## iOS simulator E2E

The Debug iOS app has a simulator-only launch path that bypasses BLE and uses
the same `DatalinkDriver` as a physical camera session. Start the mock first,
then launch the app with:

```sh
xcrun simctl launch <SIMULATOR_UDID> com.opencapture.openpocketcine.simulator \
  -opc-mock-camera \
  -opc-mock-host 127.0.0.1 \
  -opc-mock-udp-port 9004 \
  -opc-mock-tcp-port 7001 \
  -opc-mock-model pocket4pro
```

This exercises TCP poke, UDP handshake, registration, subscriptions, live
enable, status routing, and subsequent camera commands. It is intentionally
Debug/simulator-only; it does not change the physical BLE/Wi-Fi path.

For protocol unit tests, import `@openpocketcine/mock-camera/protocol` and
`@openpocketcine/mock-camera/state` directly. `MockCameraState.validate(frame)`
is useful for asserting that a migrated command has the expected wire shape.

## Limits

This mock does not advertise a BLE peripheral, implement GATT service `fff0`,
notify characteristic `fff4`, write characteristic `fff5`, or join a real
camera Wi-Fi network. It also does not generate encoded video. Physical-device
validation remains required for BLE discovery, Wi-Fi handoff, decoder output,
camera timing, and undocumented firmware behavior.
