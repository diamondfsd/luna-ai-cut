# macOS Virtual Camera

This adapter targets macOS 15 and later.

The runtime split is intentional:

```text
Luna AI Cut USB AOA receiver
  -> UCD2 media frame
  -> TCP 127.0.0.1:4184
  -> HEVC decoder (VideoToolbox)
  -> LunaCameraSharedFrameStore (BGRA)
  -> CMIOExtensionStream
  -> system camera clients
```

`Sources/LunaCameraShared.swift` is the first shared boundary. It stores only
the newest decoded frame, which keeps camera latency bounded. It must be backed
by an App Group container when the receiver and the system extension run as
separate processes; the in-process store is useful for unit/integration work.

## Xcode targets to create

Create an Xcode macOS app with these targets:

1. `LunaCameraHost` - receiver, VideoToolbox decoder, lifecycle and extension
   activation.
2. `LunaCameraExtension` - System Extension containing the CMIO provider,
   device, and output stream.

Both targets need the same App Group entitlement, for example:
`8B6J8663PS.com.diamondfsd.luna.virtualcamera`.

## Build and install the debug skeleton

From this directory:

```bash
xcodegen generate
xcodebuild -project LunaVirtualCamera.xcodeproj \
  -scheme LunaCameraHost -configuration Debug -sdk macosx build
open ~/Library/Developer/Xcode/DerivedData/LunaVirtualCamera-*/Build/Products/Debug/LunaCameraHost.app
```

The host submits an activation request for the embedded camera system
extension on launch. The first activation requires a valid Apple signing team
and user approval in macOS System Settings. A build made with
`CODE_SIGNING_ALLOWED=NO` is useful for compile checks, but cannot be expected
to register a camera device with the system.

For a repeatable signed build, set the Team ID used by both targets and run:

```bash
DEVELOPMENT_TEAM=YOUR_TEAM_ID \
CODE_SIGN_IDENTITY='Apple Development' \
./tools/build-macos-camera.sh
```

The script fails early when the Team does not have a Mac Development profile
with System Extension and App Groups enabled. It also verifies the final
entitlements before printing `systemextensionsctl list`.

## HEVC receiver path

The phone sends UCD2 frames over USB AOA. Luna AI Cut receives those frames and
forwards them unchanged to the host on local TCP port `4184`. Launch Luna AI Cut
and use its Live Console, or launch the signed host app and send a replay:

```bash
open /Applications/LunaCameraHost.app
node desktop_virtual_camera/tools/send-hevc-replay.mjs --input /path/to/preview.hevc
```

The sender forwards each complete `media type 0x01 / stream type 0x20` frame.
The host removes the UCD2
wrapper, converts HEVC Annex-B NAL units to the VideoToolbox length-prefixed
sample format, decodes to BGRA, and publishes only the newest frame to the App
Group store. The camera extension repeats the latest decoded frame at 30 FPS.

For a self-contained local decoder smoke test, run:

```bash
./tools/run-replay.sh
```

This uses a generated 1280x720/30 FPS HEVC stream and does not require a camera,
Windows, or a signed system extension. It verifies the Host receiver, decoder,
and shared-frame transport only.

The extension exposes one device named `Luna Virtual Camera`, one video
stream, and a fixed initial format of 1280x720 BGRA at 30 fps. The host should
publish decoded frames into the shared store; the extension should always
submit the newest available frame and repeat the last frame when the receiver
is temporarily idle.

Do not put HEVC decoding in the extension. Decode in the host with VideoToolbox
and pass tightly packed BGRA bytes across the App Group boundary.

## Install and approve

The camera system extension can only be activated by an app located in
`/Applications`. Luna AI Cut installs the signed `LunaCameraHost.app` there
before requesting activation.

After the first launch, approve the extension in System Settings:

- General -> Login Items & Extensions -> Camera Extensions.

Enable `Luna Virtual Camera Extension`, then return to Luna AI Cut and refresh
the Live Console. Restart Luna AI Cut if the status does not update.
