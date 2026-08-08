# 示例：单张界面图的四个特写

下面只展示程序形状。实际引用、版本和时长必须来自当前编辑空间。

```json
{
  "version": 1,
  "baseRevision": 21,
  "intent": "用同一张界面图制作四个不同区域的动态特写",
  "operations": [{
    "type": "replaceRange",
    "range": { "start": 0, "end": 8 },
    "trackRefs": ["track:video-track-id"],
    "clips": [
      {
        "ref": "shot-navigation",
        "mediaRef": "media:image-id",
        "trackRef": "track:video-track-id",
        "start": 0,
        "duration": 2,
        "framing": { "mode": "cover", "pose": { "center": [0.5, 0.14], "zoom": 1.7 } },
        "cameraMove": { "type": "move", "from": { "center": [0.48, 0.14], "zoom": 1.7 }, "to": { "center": [0.55, 0.17], "zoom": 2.05 }, "easing": "ease-out" }
      },
      {
        "ref": "shot-sidebar",
        "mediaRef": "media:image-id",
        "trackRef": "track:video-track-id",
        "start": 2,
        "duration": 2,
        "framing": { "mode": "cover", "pose": { "center": [0.14, 0.48], "zoom": 2.1 } },
        "cameraMove": { "type": "move", "from": { "center": [0.12, 0.45], "zoom": 2.1 }, "to": { "center": [0.18, 0.52], "zoom": 2.45 } }
      },
      {
        "ref": "shot-preview",
        "mediaRef": "media:image-id",
        "trackRef": "track:video-track-id",
        "start": 4,
        "duration": 2,
        "framing": { "mode": "cover", "pose": { "center": [0.56, 0.4], "zoom": 1.9 } },
        "cameraMove": { "type": "move", "from": { "center": [0.52, 0.4], "zoom": 1.9 }, "to": { "center": [0.6, 0.42], "zoom": 2.2 } }
      },
      {
        "ref": "shot-timeline",
        "mediaRef": "media:image-id",
        "trackRef": "track:video-track-id",
        "start": 6,
        "duration": 2,
        "framing": { "mode": "cover", "pose": { "center": [0.5, 0.84], "zoom": 1.8 } },
        "cameraMove": { "type": "move", "from": { "center": [0.44, 0.84], "zoom": 1.8 }, "to": { "center": [0.58, 0.8], "zoom": 2.15 } }
      }
    ]
  }]
}
```

四个片段数量相同不代表完成。验收重点是四组画面中心、缩放和运动终点确实不同。
