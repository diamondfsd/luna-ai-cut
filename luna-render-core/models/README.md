# Native beauty models

These models are loaded only by `luna-render-core`; the renderer process does not run model inference.

- `face-parsing-resnet18.onnx`: ResNet18 BiSeNet weights from
  <https://github.com/yakhyo/face-parsing/releases/tag/weights>.
  Repository code is MIT licensed. The weights were trained with CelebAMask-HQ,
  whose dataset agreement restricts use to non-commercial research and education.
  SHA-256: `0d9bd318e46987c3bdbfacae9e2c0f461cae1c6ac6ea6d43bbe541a91727e33f`.
- `scrfd-500m-kps.onnx`: UniFace SCRFD 500M face detector with five landmarks.
  SHA-256: `5e4447f50245bbd7966bd6c0fa52938c61474a04ec7def48753668a9d8b4ea3a`.
- `face-landmarks-106.onnx`: UniFace/InsightFace 106-point facial landmark model.
  SHA-256: `f001b856447c413801ef5c42091ed0cd516fcd21f2d6b79635b1e733a7109dbf`.

Do not ship `face-parsing-resnet18.onnx` in a commercial distribution without
replacing it with weights trained from appropriately licensed data.
