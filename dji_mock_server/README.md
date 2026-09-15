# DJI protocol Mock

DJI Mock uses the OpenPocketCine Node camera service vendored in `opc/`.
The protocol core is unchanged. See `opc/README.md` for the strict startup
sequence, commands, fault injection and HTTP controls.

The main test surfaces are UDP video-frame preview and `00/28` media deletion.
BLE/GATT and Luna camera protocols are not emulated. This service does not
provide the old `/ble/*` HTTP bridge; automatic BLE preparation in the desktop
application is outside this protocol-test workflow.

## Start

```sh
pnpm mock:dji --model pocket4 --media-root /path/to/media --video-source /path/to/preview.hex
pnpm mock:dji --model pocket4pro --video-source /path/to/preview.hex
```

Defaults are host `127.0.0.1`, UDP `19004`, TCP `17002`, HTTP `18082`, model
`pocket4` and JSON logs. `--root` remains an alias for `--media-root`.
Supported models: `pocket4`, `pocket4pro`, `pocket3`, `nano`. Action 5 Pro is
not supported by this source; it is not silently mapped to a Pocket model.

The media catalog is deterministic, not a directory scan. Place real files
under camera-relative paths such as
`DCIM/100MEDIA/DJI_20260913120001_0001_D.MP4`, not the old `sdcard/internal`
directory mapping. Tests can inject a catalog with `new MockCameraServer({
media: [...] })`; `server.state.media` exposes the full records. Missing
files use upstream deterministic placeholder bytes.

`--video-source` is a text file with one complete Annex-B access unit in hex
per line. The service sends UDP `pktType=02` fragments; it does not encode
or decode supplied video. Without a source the local wrapper generates a
moving 320x180 AVC test pattern using FFmpeg (25 complete IDR frames looped).
The application passes its bundled FFmpeg path; CLI users can set
`--ffmpeg /path/to/ffmpeg`. `--permissive` is opt-in;
strict protocol validation remains the default. The old `--rate-mbps` and
`--drop-after-bytes` flags are not supported; use `/control` fault injection.

Default logs contain startup, shutdown and rate-limited errors/rejections only.
UDP ACKs, video fragments and successful commands are not logged individually.
Use `--verbose-log` to enable upstream per-packet traffic logs. `/health`
metrics remain available in either mode.

## Tests

```sh
pnpm test:dji-mock-preview
pnpm test:dji-delete
```

Tests use isolated directories and ephemeral ports, without Electron or UI
automation. Preview checks strict startup, AVC/HEVC frame reassembly and video
faults. Delete checks strict UDP replies, catalog removal, duplicate replay,
HTTP visibility and rejection without mutation. Deleting a catalog entry
never deletes the source fixture file.

### Known Wire Difference

The upstream single-handle delete payload is 18 bytes and requires bytes
10/11 to be `01 01` and bytes 12..17 to be zero. The current project's
`buildDjiDeletePayload` instead stores a uint32 count at 10..13 and `01 01`
at 14/15. The new Mock rejects that variant with `df`. The test records this
disagreement explicitly; replacing the Mock does not change the production
delete codec or establish which format physical firmware accepts.

## Source

Copied from `/Users/zhouchao/projects/OpenPocketCine/tools/opc-mock-camera`
on 2026-09-15, source checkout HEAD
`b83a7e77a3db3390685f230c82d4bb3075a24cba` (local working-copy content).
Original files in `opc/` are kept byte-for-byte; `server.mjs` is the local
CLI wrapper. Apache-2.0 license and original NOTICE are included in `opc/`.
