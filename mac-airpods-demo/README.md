# Mac AirPods Motion Demo

这个演示用于验证两件事：

1. macOS 14+ 是否可以通过 `CMHeadphoneMotionManager` 读取 AirPods 头部运动。
2. Mac 是否可以把运动映射成 Luna 相机 Wi-Fi 云台控制。

## 运行

要求：macOS 14+、Swift/Xcode Command Line Tools、支持头部运动的 AirPods。

```bash
cd /Users/REDACTED/projects/luna-ai-cut
node mac-airpods-demo/build-motion-helper.mjs
node mac-airpods-demo/server.mjs
```

然后打开 <http://127.0.0.1:8787>。AirPods 测试不依赖相机：直接点击“启动 AirPods”，确认顶部显示已连接，再转动头部观察姿态数据。

姿态区域的“重置零点”会把当前头部姿态记录为基准，之后页面显示相对这个基准的变化；开启头部跟随时也会同步更新跟随基准。

第一次点击“启动 AirPods”时，macOS 可能会弹出运动权限请求。需要先连接 AirPods；如果只想验证页面和控制链路，可以使用“模拟运动”。

## 真实相机测试（可选）

### Mac 直连 Luna

1. 让 Mac 连接 Luna 相机 Wi-Fi。
2. 保持“直连相机 Wi-Fi”和默认地址 `192.168.42.1:6666`，点击连接相机。
3. 先使用手动方向按钮确认云台控制方向。
4. 勾选头部跟随，再启动 AirPods 运动。

### 手机 TCP 中转

1. Android 手机连接 Luna 相机 Wi-Fi，并在 App 的“电脑命令通道”中启动“手机相机中转”。
2. 通过 USB 网络共享把手机连接到 Mac；在 Android 页面复制一个“电脑连接地址”。
3. 在本页面选择“手机 TCP 中转”，把目标地址填写为手机地址，端口保持固定的 `26666`，再点击连接相机。
4. 连接成功后，Mac 仍负责生成完整 Luna 协议帧；手机只把 TCP 字节流转发到 `192.168.42.1:6666`。
5. 先使用手动方向按钮确认云台控制方向，再开启头部跟随。

如果手机页面同时运行“手机回显测试”，它会占用同一个 `26666` 端口；先停止回显测试，再启动相机中转。

头部跟随默认关闭，且有死区；页面只展示数据时不会给相机发送移动命令。所有移动都有短时自动停止，点击停止或断开连接也会发送停止。

## 结构

- `server.mjs`：本地 HTTP/SSE 服务、运动事件转发、跟随决策和 Luna TCP 控制。
- `HeadphoneMotion.swift`：只负责调用公开的 Core Motion API，并输出 JSON Lines。
- `index.html`：演示页面。

Node 本身不能直接调用 Core Motion，因此 AirPods 采集放在 Swift helper；这不是私有蓝牙协议，也不需要自己解析 AirPods 广播包。
