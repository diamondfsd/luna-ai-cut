# 多设备媒体接入架构

## 目标

Luna AI Cut 的设备接入范围是“连接相机并管理照片/视频素材”。所有设备都通过统一的媒体源契约向上层提供能力，设备厂商差异只留在各自适配器内部。

当前范围不包含云台、姿态、摇杆、拍摄控制或其他相机控制协议。DJI 协议参考 [KonradIT/osmosis](https://github.com/KonradIT/osmosis)，当前仅接入媒体清单和媒体读取所需的 BLE/Wi-Fi/TCP/UDP 流程。

## 分层

```text
连接页 / 素材库
        |
CameraMediaSourceApi
  connect / check / listFiles / deleteFiles / disconnect
        |
cameraMediaSourceFor()  根据 DeviceDefinition.protocol 注册适配器
        |
媒体适配器
  Insta360(Luna)   Insta360(GO Ultra)   DJI(Pocket 4 / 4P)   Mounted
        |
厂商协议实现 + 可选连接准备策略
```

`CameraMediaSourceAdapter` 是 Electron 主进程内的统一适配器契约。它只暴露媒体操作，不要求所有设备都实现相同的连接准备流程。

## 统一接口和可选能力

核心操作固定为：

- `connect()`：建立媒体访问会话
- `check()`：检查连接和服务状态
- `listFiles()`：读取照片/视频清单并映射为 `LunaFile`
- `deleteFiles()`：删除设备端素材；不支持时通过能力标记和用户可读错误返回
- `disconnect()`：关闭应用持有的会话

`CameraMediaSourceCapabilities` 同时描述媒体能力和连接准备能力：

- `list` / `preview` / `copyToLocal` / `delete` 等媒体能力
- `connection.bluetoothActivation`
- `connection.bluetoothWifiCredentials`
- `connection.automaticWifiJoin`
- `connection.manualWifiCredentials`

连接准备通过 `CameraMediaSourceOptions.wireless` 传递。密码只作为本次连接参数使用，不写入应用设置。DJI 额外提供 `prepareConnection()`：先通过蓝牙读取 Wi-Fi 信息并断开 BLE，用户手动切换 Wi-Fi 后再调用统一的 `connect()`。未来需要系统 Wi-Fi 自动加入时，只新增对应策略实现，不改变素材列表接口。

## Luna Wi-Fi 连接确认

macOS 的 CoreWLAN 在应用缺少定位/无线网络相关权限，或系统版本限制时，可能在 Wi-Fi 已经关联成功后仍返回空 SSID。`interface.ssid()` 为空不能作为“未连接”的判断，也不能阻断 Luna Ultra 的自动连接流程。

Luna Ultra 和 Luna Pro 使用相同的 Wi-Fi/TCP 控制链路，自动连接的确认链路固定为：

```text
CoreWLAN 发起连接
  -> 连接 192.168.42.1:6666
  -> 发送 UCD2 STREAM hello（UCD2 / type=STREAM / f6cc4f09）
  -> 写入成功后确认 Luna 控制通道可用
  -> 建立正常 Luna TCP 会话
```

SSID 只用于扫描、日志和界面展示。实际连接状态以相机控制端口的 UCD2 STREAM 探测为准；Luna 不保证对该单向 hello 返回响应，因此 TCP 连接和握手帧写入成功就是此阶段的协议确认。失败时才提示检查 Wi-Fi 名称和密码。

## 设备注册

设备定义中的 `protocol` 决定适配器：

| protocol | 设备 | 媒体实现 |
| --- | --- | --- |
| `insta360` | Luna Ultra / Luna Pro | `LunaUltraProtocol`（共用 Wi-Fi 协议） |
| `go-ultra` | GO Ultra | `GoUltraProtocol` |
| `dji` | Osmo Pocket 4 / 4P | `DjiCameraSession` |
| `mode=wired` | 任意已挂载相机磁盘 | `MountedCameraMediaSource` |

新增设备时，优先新增设备定义和协议注册项，不在连接服务里增加基于设备 ID 的条件分支。机型差异（例如 Pocket 4 与 Pocket 4P 的识别字段、端口和 Mock model）放入设备 profile/config。

## DJI 无线准备策略

DJI 媒体会话分为两步：

1. `DjiWirelessPreparation` 准备 Wi-Fi 信息。
2. `DjiCameraSession` 使用当前 Wi-Fi 建立 TCP/UDP 媒体会话并读取清单。

准备策略目前支持三种结果：

- `bluetooth`：通过 Mock 或 Electron Web Bluetooth 执行完整 BLE DUML 配对和 Wi-Fi 信息读取
- `manual-wifi`：用户已经在系统中连接相机 Wi-Fi，应用直接使用该连接
- `already-connected`：跳过 BLE，直接复用用户已经连接好的相机 Wi-Fi

真实 BLE transport 由 Electron Web Bluetooth 承载，macOS 和 Windows 都通过 `DjiBleTransport` 接入。媒体清单、下载、预览和删除能力不需要重新实现。

## Mock 验收

DJI Mock 服务同时提供：

- HTTP 媒体服务：默认 `18080`
- TCP poke 服务：默认 `17001`
- UDP DUML 媒体会话：默认 `19004`
- BLE HTTP bridge：`/ble/arm`、`/ble/exchange`、`/ble/confirm`
- 状态检查：`/health`、`/ble/advertisement`、`/ble/state`

命令行验收示例：

```bash
pnpm mock:dji -- --root /path/to/media --model pocket4
```

Pocket 4P 使用 `--model pocket4pro`（内部参数保持兼容）。素材目录可以直接放文件，也可以按 `sdcard/` 和 `internal/` 分目录。应用中选择对应 DJI 设备，把地址设为 `127.0.0.1:18080`，连接后应能验证 BLE 准备、UDP 清单读取、HTTP HEAD 和媒体预览。

应用内 Mock Server 也会根据当前设备定义中的 `protocol` 和 `mock.model` 启动对应服务。

## 后续实现顺序

1. 在真实 macOS 和 Windows 设备上验证 Pocket 4 / Pocket 4P 的连接、通知分片和 Wi-Fi 信息读取；保持 `DjiBleTransport` 字节协议接口不变。
2. 根据用户输入补齐系统 Wi-Fi 连接策略；默认仍允许用户手动切换 Wi-Fi。
3. 为设备定义补充每个机型的存储、预览、删除和连接能力矩阵。
4. 新增设备时只增加 profile、协议实现和 Mock fixture，并复用 `CameraMediaSourceApi`。
5. 设备控制类能力另建独立接口，禁止复用或污染媒体适配器。
