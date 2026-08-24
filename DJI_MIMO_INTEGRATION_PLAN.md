# DJI Mimo 协议接入计划

> 状态：Pocket 4 / Pocket 4 Pro 协议基线与 mock 服务已实现，真实 BLE/Wi-Fi 原生适配器待接入
>
> 日期：2026-08-23
>
> 参考工程：[`KonradIT/osmosis`](https://github.com/KonradIT/osmosis)
>
> 本文记录接入方案、当前实现边界和后续硬件工作；不修改 Osmosis，只移植协议行为。

当前先以 **Pocket 4 为协议基线，Pocket 4 Pro 为紧随其后的 mock 验收目标**。按照当前工作区的约束，不等待或运行 Osmosis/项目测试套件，先以 mock service 完成应用链路验收，再进入真实硬件适配。

## 1. 结论先行

DJI Osmo 的接入不能按“扫描 Wi-Fi、输入密码、访问 HTTP”实现。完整链路必须是：

```text
扫描 DJI BLE 广播
  -> BLE GATT 连接
  -> 订阅 fff4 / fff5 通知
  -> 发送 DUML 配对与唤醒命令
  -> 通过 BLE 读取相机自己的 SSID 和密码
  -> 唤醒并加入相机 Wi-Fi
  -> UDP DUML 握手和媒体清单读取
  -> HTTP 缩略图、预览和原文件下载
```

建议把 Osmosis 当作协议和行为参考，移植其中的纯协议逻辑；不要把 Android Activity、Android Bluetooth、Android Wi-Fi API 直接搬进 Luna。Luna 的实现应放在 Electron 主进程和原生系统桥接层，React 渲染进程只负责展示连接阶段和素材结果。

第一版建议直接以 **Osmo Pocket 4 / Pocket 4 Pro** 为目标，但分成两个硬件验收顺序：先用 Pocket 4 建立完整链路基线，再用 Pocket 4 Pro 验证新 BLE 广播格式、双存储和 AP 掉线恢复。无人机 QuickTransfer、Osmo 360/WPA3、删除和复杂控制能力放到后续阶段。这样可以先验证最核心的 BLE 取凭据和桌面切换 Wi-Fi 风险，同时尽早覆盖 Pocket 4 Pro 的差异。

## 2. 已检查的代码

### Osmosis

| 能力 | 主要文件 | 对接结论 |
| --- | --- | --- |
| BLE 扫描与机型识别 | `app/src/main/java/dev/konraditurbe/osmosis/ble/OsmoScanner.kt`、`BleAdvert.kt`、`CameraModel.kt` | 需要移植 DJI 公司标识、型号 ID、广播名称和 Xtra OUI 识别规则 |
| GATT 通道 | `app/src/main/java/dev/konraditurbe/osmosis/ble/GattClient.kt` | 需要重写为桌面原生 BLE 适配器；服务和特征 UUID、通知顺序、写入类型是关键 |
| DUML 帧 | `app/src/main/java/dev/konraditurbe/osmosis/duml/DjiMessage.kt`、`DjiCrc.kt`、`ByteReader.kt`、`ByteWriter.kt` | 适合移植为纯 TypeScript，并补充字节级测试 |
| 配对、唤醒、Wi-Fi 凭据 | `duml/OsmoCommands.kt`、`duml/Payloads.kt`、`ui/MainActivity.kt` | 需要做成有超时、重试、确认等待和保活的状态机 |
| Wi-Fi 接入 | `app/src/main/java/dev/konraditurbe/osmosis/net/ApJoiner.kt` | Android 使用 `WifiNetworkSpecifier` 和进程绑定；桌面端要改为 macOS/Windows 系统网络适配器 |
| UDP DUML 会话 | `net/DumlTransport.kt`、`net/DumlSession.kt`、`camera/CameraSession.kt` | 需要 Node `dgram` 版本，不能直接复用阻塞式 Kotlin Socket 代码 |
| 媒体清单解析 | `camera/CameraSession.kt`、`camera/PathAddressing.kt`、`core/MediaAddressing.kt` | 需要移植 CompositePack、分页、存储和机型差异；这是媒体接入的主要工作量 |
| HTTP 媒体访问 | `net/HttpClient.kt`、`net/MediaDownloader.kt`、`net/ImageLoader.kt` | 可优先映射到 Luna 已有下载/缓存流程，但必须验证 Range、断点续传和大文件行为 |
| 规范与抓包结论 | `MEDIA_PROTOCOL.md`、`docs/01-protocol-map.md` | 作为协议合同和硬件验收依据；未验证机型不能仅凭表格承诺支持 |

### Luna 当前实现

| 能力 | 主要文件 | 当前状态 |
| --- | --- | --- |
| 设备协议抽象 | `electron/deviceProtocols.ts` | `DeviceProtocol` 假设设备已经有 host；需要增加 DJI 的 BLE/Wi-Fi 会话入口 |
| 媒体源抽象 | `electron/cameraMediaSourceService.ts`、`electron/ipcCameraMediaSourceService.ts` | 已有 `connect/check/list/delete/disconnect` 边界，适合新增 `DjiCameraMediaSource` |
| BLE 扫描 | `electron/bluetoothCoreScanner.swift`、`electron/bluetoothDebugService.ts` | 目前只有一次性扫描和广播信息回传，没有生产级 GATT 会话 |
| 浏览器 GATT 调试 | `src/pages/BluetoothTab.tsx` | 仅适合人工试验；不能承担 DJI 的双特征订阅、无响应写入、帧匹配、保活和跨平台发布 |
| Wi-Fi 系统操作 | `electron/wifiCoreWlan.swift`、`electron/wifiDebugService.ts` | macOS/Windows 已有基础连接能力，但注册和会话绑定还需为 DJI 连接流程整理 |
| IPC 注册 | `electron/ipcConnectivityService.ts`、`electron/appMain.ts`、`electron/preload.ts` | 适合新增独立 `ipcDjiCameraService.ts`，不把协议细节暴露给页面 |
| 文件模型和下载 | `src/shared/types/media.ts`、`electron/storage/fileService.ts`、`electron/media/resumableDownloadService.ts` | `LunaFile` 能承载 DJI 媒体，但需要稳定 ID、存储 ID、预览 URL 和机型适配器 |
| 连接页面 | `src/pages/DeviceConnectPage.tsx`、`useMediaLibraryController.ts` | 需要显示“蓝牙获取连接信息 / 等待相机确认 / 加入相机 Wi-Fi / 读取素材”等阶段 |

## 3. Osmosis 已确认的 DJI 流程

### 3.1 BLE 设备识别

Osmosis 不只依赖设备名称。它从 DJI 公司标识 `0x08AA` 的 manufacturer data 中解析型号 ID，并用名称、MAC/OUI 等信息处理重命名设备和 Xtra Edge Pro 重品牌设备。

已记录的典型型号包括：

| 型号 | model id | 常规数据链路 | 备注 |
| --- | ---: | --- | --- |
| Osmo Action 5 Pro | `0x0015` | UDP 9004 + TCP 7001 poke | Xtra Edge Pro 同 ID，但改为 UDP 10004、无 poke |
| Osmo Action 6 | `0x0018` | UDP 9004 + TCP 7001 poke | 双存储 |
| Osmo Nano | `0x0019` | UDP 9004 + TCP 7001 poke | 已有 Osmosis 硬件验证 |
| Osmo Pocket 3 | `0x0020` | UDP 9004 + TCP 7001 poke | 需要先进入播放模式再列文件 |
| Osmo Pocket 4 | `0x0021` | UDP 9004 + TCP 7001 poke | 第一台基线；双存储 |
| Osmo Pocket 4 Pro | `0x0022` | UDP 9004 + TCP 7001 poke | 第二台验收；新 BLE 广播格式，需重点验证掉线恢复 |

第一版应保留未知型号的原始广播数据和原始型号 ID，不能因为名称匹配失败就丢弃设备。未知型号先进入“已发现、暂不支持”的状态，不自动发送破坏性命令。

### 3.2 Pocket 4 / Pocket 4 Pro 的实际覆盖情况

Osmosis 的 README 将 Pocket 4 / Pocket 4 Pro 标为 `Verified on hardware`，但代码注释和测试资产显示两者的验证深度并不完全相同：

| 项目 | Pocket 4 | Pocket 4 Pro |
| --- | --- | --- |
| BLE 型号识别 | 经典格式，manufacturer payload 前两字节为 `0x0021` | 新格式，payload byte 5 的 flag 置位，byte 10-11 为 product type `218/HG224`，映射为 `0x0022` |
| 配对、取凭据、AP、UDP | 已确认 | 已确认 |
| 媒体清单 | 45 文件 `op4_45.bin`，有 golden/invariant/handle 测试 | 46 文件跨两个存储，代码注释有真实记录，但当前仓库没有同等完整的 Pro manifest fixture |
| 播放模式 | 可能需要两次 `0x02/0x0c` 尝试 | 需要按真实设备确认，沿用相机 session 流程 |
| 媒体路径/句柄 | `DCIM/DJI_001/DJI_…_D`；内部存储 handle base `0x40100000`，step `0x40` | `DCIM/DJI_001/DJI_…`；handle base `0x00100000`、step `0x40` 的记录仍带不确定标记 |
| HTTP 存储映射 | 内部存储为 `/v2?storage=1`；设备表现为双存储，即使没有卡也可能有第二块存储 | 记录为 storage `45 -> 0`、`1 -> 1`，需要用实机清单和 HTTP 请求确认 |
| 下载稳定性 | 有完整下载验证依据 | 已传输约 43 MB 后 AP 掉线；需要专门验收重连/断点恢复，不能只验证首个小文件 |

因此第一版不是“只支持 Pocket 4，Pro 以后再说”，而是 **P4 先作为协议基线，P4P 从同一套协议实现中尽早补齐机型差异**。P4P 的目标不是重新实现一套协议，而是补充新格式广告解析、清单 fixture、存储映射和 AP 掉线恢复。

### 3.3 GATT 初始化硬约束

目标服务是 `fff0`，核心特征是：

- `fff4`：通知通道，同时需要写入 `01 00` 以准备配对；
- `fff5`：DUML 写入通道，必须使用 Write Without Response；
- 两个特征的 CCCD 都要订阅，不能只订阅 `fff4`；
- 应用发出的 DUML 帧 `cmd_type` 必须为 `0x40`；
- 收到的通知要按 DUML 帧解析，使用消息 ID 与命令集/命令 ID 做请求匹配；
- BLE 链路不要求系统级加密或传统蓝牙配对，DJI 自己的应用层配对确认是主要配对过程。

Osmosis 的文档和实现存在一个必须先验证的差异：

- `MEDIA_PROTOCOL.md` 的醒目标注要求 MTU 500，并警告协商到 517 后相机可能完全不响应；
- `docs/01-protocol-map.md` 和当前 `GattClient.kt` 却使用/请求 517。

因此不能机械复制 `requestMtu(517)`。第一阶段要用真实硬件记录“请求值、实际协商值、首个命令响应”三者，按机型配置 MTU；如果桌面平台无法主动控制 MTU，也要在连接诊断中明确记录实际值。

### 3.4 BLE 配对与取 Wi-Fi 密码

相机配对 token 是 `osmo`。无人机使用 `DJI FLY`，暂不纳入第一版。

配对标识不能每次连接随机生成，也不应写死为 Osmosis 作者的标识。应在 Luna 本地生成一次、持久化一次，并在重试时复用同一标识；否则相机会重复弹确认或消耗配对记录。

核心交互如下：

```text
fff4 <- [01 00]                         准备配对
fff5 <- 00/2b, target 0xF0, payload 04 00  唤醒会话
fff5 <- 07/45, token osmo + app identity   发起应用层配对
fff4 -> 07/45 status 01                  已配对，直接继续
fff4 -> 07/45 status 02                  等待相机屏幕确认
fff4 -> 07/46 request                    确认完成，需要按请求回复/ACK
fff5 <- 53/10, target 0x1C               唤醒相机 Wi-Fi 能力
fff5 <- 00/2b, target 0xF0, payload 01 01  持续保活
fff5 <- 07/07                          读取 SSID
fff4 -> 07/07 [status][PackString ssid]
fff5 <- 07/0e                          读取 Wi-Fi 密码
fff4 -> 07/0e [status][PackString password]
```

两个凭据查询需要错开，建议先按约 500 ms 的保守间隔实现，并让状态机根据响应推进，不允许并发写入。密码只在主进程内存中短暂存在：不写日志、不放 `ConnectionStatus`、不回传渲染进程、不写设置文件。

### 3.5 加入相机 Wi-Fi

相机返回的是相机自己的热点凭据，不是用户当前网络的凭据。大多数 Osmo 相机的 AP 地址是 `192.168.2.1`。

桌面端需要：

1. 保存当前网络状态，提示用户应用将切换到相机 Wi-Fi；
2. 用平台原生接口连接返回的 SSID/密码；
3. 等待网络获得本地地址，并探测 `192.168.2.1`；
4. 建立 UDP/TCP/HTTP 会话；
5. 断开相机后恢复用户原来的网络（至少恢复应用能控制的连接配置，并给出失败提示）。

`ApJoiner.kt` 的 `bindProcessToNetwork` 在 Android 上能让应用只使用相机网络。桌面 Electron 没有等价的按进程网络绑定，第一版应把“系统 Wi-Fi 切换”作为明确的用户可见状态和风险点处理。不能假设 Node Socket 会自动选中正确网卡。

现有 `wifiCoreWlan.swift`/`wifiDebugService.ts` 可以作为 macOS/Windows 网络操作基础，但要先整理成 DJI 专用的异步流程。特别是 `ipcConnectivityService.ts` 当前对 Wi-Fi 调试操作按平台注册，不能直接假定现有 IPC 在 macOS 的生产连接入口可用。

### 3.6 UDP DUML 会话和媒体列表

Wi-Fi 凭据成功后，协议还没有完成。需要移植：

- UDP 数据链路的封装、路由头、序列号、窗口和 ACK；
- 9004/10004 端口和 TCP 7001 poke 的机型选择；
- Camera session 的握手、设备注册、APP presence 和参数订阅；
- 播放模式切换和保活；
- `0x00/0x26` 请求到分片 `0x00/0x27` 响应的重组；
- CompositePack 媒体路径、文件类型、大小、时间、预览文件和删除句柄解析；
- 双存储设备的 store 映射和分页游标。

Osmosis 已经明确区分：

- Osmo 相机：CompositePack 路径清单；
- DJI 无人机：DCF 索引清单和独立的 `0x51` session-open。

这也是第一版只做 Osmo 相机的原因。无人机不能用相机清单解析器“顺便支持”。

### 3.7 HTTP 媒体访问

清单中的代理文件不一定会单独列出，预览 URL 需要根据原文件路径替换扩展名，例如 `.LRF` 或 Xtra 的 `.XRF`；原文件通过相机 HTTP 服务读取，并可能需要 `storage` 参数区分内部存储与 SD 卡。

接入 Luna 时：

- 将原文件和预览 URL 映射到 `LunaFile.sourceUrl` / `previewUrl`；
- 用 `storageId` 和稳定的路径/句柄生成 `LunaFile.id`，不能只用文件名；
- 尽量复用 Luna 的本地缓存、缩略图和可恢复下载服务；
- 先验证 HTTP Range、断线恢复、超大文件和相机 AP 短暂掉线；
- 下载阶段保持 DUML 会话和 BLE 保活，避免部分机型因链路空闲关闭 AP。

## 4. 推荐的 Luna 架构

### 4.1 分层

```text
React 页面
  -> preload / IPC（连接阶段、候选设备、状态事件）
  -> DjiCameraMediaSource / DjiProtocol（一次完整会话）
     -> DjiBleTransport（原生 BLE 长连接）
     -> DjiWifiAdapter（macOS/Windows 网络切换）
     -> DjiDumlTransport（UDP/TCP DUML）
     -> DjiCameraSession（注册、播放、清单、保活）
     -> DjiMediaAdapter（LunaFile 映射与 HTTP URL）
```

纯协议部分不依赖 Electron：

- `electron/dji/djiBytes.ts`
- `electron/dji/djiCrc.ts`
- `electron/dji/djiMessage.ts`
- `electron/dji/djiPayloads.ts`
- `electron/dji/djiModelProfiles.ts`
- `electron/dji/djiManifestParser.ts`

运行时部分只在主进程：

- `electron/dji/djiBleSession.ts`
- `electron/dji/djiWifiHandoff.ts`
- `electron/dji/djiDumlTransport.ts`
- `electron/dji/djiCameraSession.ts`
- `electron/dji/djiProtocol.ts`
- `electron/dji/djiMediaAdapter.ts`

IPC 单独放在 `electron/ipcDjiCameraService.ts`，通过项目已有的 `import.meta.glob('./ipc*.ts')` 自动注册。所有特征写入、密码、原始 BLE 帧和 UDP 调试数据都留在主进程；渲染进程只接收脱敏状态和最终媒体数据。

### 4.2 BLE 原生实现选择

推荐顺序：

1. **第一阶段 macOS：复用 CoreBluetooth 方向，新增长连接 GATT helper。** 当前 `bluetoothCoreScanner.swift` 已能启动 CoreBluetooth，但它只做一次性扫描。新 helper 要能持续运行，支持扫描、连接、服务发现、两个 CCCD、`fff4` 有响应写入、`fff5` 无响应写入、通知转发、断开和取消。
2. **发布构建：确认不依赖用户安装 Swift 工具链。** 当前项目开发和部分原生能力通过 `swift <script>` 启动；DJI BLE 是产品主链路，打包时应使用可随应用发布的原生 helper，或明确验证目标系统具备所需运行时。
3. **Windows：单独实现 WinRT BLE 适配器。** 不把 CoreBluetooth 逻辑和 Swift helper 当作 Windows 方案。Windows 版本至少要验证 BLE 广播、GATT Write Without Response、通知订阅、连接断开回调和权限行为。
4. **不把浏览器 Web Bluetooth 作为正式方案。** 现有 `BluetoothTab.tsx` 保留作实验/诊断工具即可；它不能控制所有底层连接参数，也不适合承载跨平台原生权限和长连接状态机。

原生 helper 建议使用 JSON Lines 或等价的请求/事件协议：主进程发送带 request ID 的命令，helper 输出结构化事件；BLE 通知必须是异步事件，不能用一次性命令等待完整结果。原始字节只用于本地诊断，默认日志脱敏。

### 4.3 设备与媒体抽象调整

在现有 `DeviceDefinition`/`DeviceProtocol` 基础上增加“协议族/连接方式”概念，不要把 DJI 当成一个硬编码的 Luna 型号：

- `deviceId` 使用 `dji-osmo` 或具体型号 ID；
- `protocolFamily` 区分现有 Insta360/Luna 与 DJI DUML；
- `connectionMode` 增加“BLE + Wi-Fi handoff”语义；
- `DjiModelProfile` 保存型号 ID、广播特征、配对 token、Wi-Fi 类型、UDP 端口、TCP poke、媒体清单类型、存储映射和代理扩展；
- `DeviceProtocol.connect()` 允许没有预先 host，连接成功后再得到 `192.168.2.1`；
- `ConnectionStatus` 只返回型号、序列号、SSID、连接阶段和能力，不返回 Wi-Fi 密码；
- `CameraMediaSourceAdapter` 的 delete 能力第一版关闭，等句柄和安全确认完成后再开放。

## 5. 分阶段实施计划

### Phase 0：目标与硬件基线

交付物：

- 确认第一台目标设备和系统，固定为 Osmo Pocket 4；同时准备 Osmo Pocket 4 Pro 作为第二验收设备；
- 建立设备测试表：首次配对、已配对重连、拒绝确认、BLE 断线、Wi-Fi 切换、AP 未出现、UDP 握手失败、下载中断；
- 固化至少一组 Pocket 4 和一组 Pocket 4 Pro 的脱敏 BLE/DUML 抓包或字节 fixture；密码和真实个人网络信息不得进入仓库；
- 核对 MIT 代码引用的保留范围和致谢；协议文档只作为参考，第三方实现代码移植时保留原许可证要求。

验收：Pocket 4 能确认广播型号、BLE 服务和特征，并明确实际 MTU 行为；Pocket 4 Pro 能确认新格式 product type `218/HG224` 不会被识别为未知型号。

### Phase 1：纯 TypeScript 协议内核

交付物：

- DUML 帧 encode/decode、CRC、字节序和 `PackString`；
- 配对、唤醒、Wi-Fi 查询、ACK、状态响应的命令 builder/parser；
- DJI 广播和机型 profile 解析；
- UDP 外层头、路由头、序列号和握手帧的纯函数；
- CompositePack 最小清单解析器和 `LunaFile` 映射前的中间模型。

验收：不连接设备也能通过 fixture 做字节级 round-trip、坏 CRC、截断帧、未知命令和多个分片重组测试。

### Phase 2：macOS BLE 长连接

交付物：

- CoreBluetooth helper 的扫描、连接、服务发现和通知事件；
- 严格实现两个 CCCD 订阅和 `fff4`/`fff5` 两种写入类型；
- 主进程 BLE session 状态机：连接、配对、等待相机确认、重试、超时、断开；
- 每安装一次生成并持久化 app identity；
- 不记录密码和完整敏感帧的日志脱敏规则。

验收：首次配对需要用户在相机确认，已配对设备能静默重连；能从 BLE 读到 SSID 和密码长度，并在日志中证明不是手工输入。

### Phase 3：Wi-Fi handoff

交付物：

- 将 BLE 返回的 SSID/密码交给 macOS CoreWLAN；
- 等待系统切网、获取本地地址并探测 `192.168.2.1`；
- 会话期间防止普通 Wi-Fi 调试页/其他连接流程抢占网络；
- 连接失败、用户取消、AP 未出现、切网后无法恢复时给出可行动的错误；
- 记录原网络快照并在断开时恢复或提示用户恢复。

验收：不手工查看或输入密码即可加入相机 AP，能持续访问相机地址；断开后用户网络不会被静默遗留在相机热点。

### Phase 4：Osmo UDP/HTTP 媒体链路

交付物：

- `dgram` UDP transport 和 TCP-7001 poke；
- Camera session 注册、播放模式、清单分页、保活和关闭；
- Pocket 4 的照片、视频、预览文件和大小/时间解析；Pocket 4 Pro 的同类数据使用独立 fixture 校验；
- 生成带 storage/path/handle 的稳定 `LunaFile`；
- 复用 Luna 缓存和可恢复下载，保留原始扩展名与下载名策略。

验收：Pocket 4 真实硬件连接后能读取媒体网格，打开预览，下载一个小文件和一个大文件；Pocket 4 Pro 先完成跨两个存储的清单和预览，再验证大文件传输中 AP 掉线后的恢复或明确失败，不产生错误完成记录。

### Phase 5：Luna 正式产品流程

交付物：

- `CameraMediaSource` 接入 DJI protocol adapter；
- `DeviceConnectPage` 显示 BLE 配对确认、Wi-Fi 切换和媒体读取阶段；
- 复用现有设置、媒体库、缩略图、下载队列和连接断开回调；
- 设备能力控制：第一版只开放浏览、预览、下载；删除、收藏、录制控制默认关闭；
- 诊断信息包含机型、阶段、端口、超时和错误码，不包含 Wi-Fi 密码。

验收：从正常用户入口完成“发现设备 -> 确认 -> 连接 -> 浏览 -> 下载 -> 断开”，不要求用户打开调试页，不影响现有 Luna/Go Ultra 流程。

### Phase 6：Windows 与扩展机型

交付物：

- WinRT BLE 原生适配器和 Windows Wi-Fi handoff；
- Action 5/Xtra 10004/no-poke 分支；
- 其他机型的双存储、Action 1 index 清单等差异；Pocket 4 / Pocket 4 Pro 不再作为后续扩展项；
- 无人机 `DJI FLY` token、9003、`0x51` session-open 和 DCF 清单作为独立协议族；
- 只有经过硬件验证的能力才加入设备 profile 的“支持”状态。

验收：按机型矩阵逐项通过；未知或未验证机型保持可诊断但不伪装成已支持。

## 6. 测试与验证要求

### 6.1 纯逻辑测试

必须覆盖：

- DUML 帧长度、CRC、LE 字节序、`cmd_type=0x40`；
- `PackString` 的 UTF-8、空值、长度边界和截断；
- `07/45` 已配对/需确认、`07/46` 请求、`07/07`/`07/0e` 响应解析；
- BLE 通知中多帧、半帧、未知帧和错误帧；
- UDP 分片、重复片段、乱序、超时、错误 session；
- CompositePack 记录、分页去重、双存储、未知扩展名；
- Xtra 与 DJI 同 model id 的 OUI 分流；
- 密码不出现在日志和序列化状态对象。

项目当前没有统一 Vitest/Jest 脚本，第一版可沿用 `scripts/test-*.mjs` + `node --experimental-strip-types` 的轻量测试方式；协议核心稳定后再评估是否引入专用测试运行器。

### 6.2 原生与硬件测试

按照项目约定，先跑纯逻辑和服务测试，再做 Electron 行为测试。涉及真实 BLE、Wi-Fi 和 Electron 生命周期时，使用 Playwright Test 的 Electron fixture；不新增 agent-browser、手写 CDP 或另一套 E2E 执行器。

硬件验收最少包含：

1. 首次配对并在相机屏幕确认；
2. 已配对重连；
3. 在配对确认阶段关闭/断开 BLE；
4. BLE 获取 SSID/密码后 AP 延迟出现；
5. 用户取消 Wi-Fi 切换；
6. UDP 9004 与 Xtra 10004 的端口分支；
7. 相机 AP 在浏览或下载中掉线；
8. 下载文件校验和断点恢复；
9. 退出应用时 BLE、UDP 和 Wi-Fi 恢复；
10. 现有 Luna 与 Go Ultra 回归。

## 7. 风险与处理

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| macOS/Windows BLE GATT 能力不一致 | 连接链路无法跨平台复用 | BLE 仅定义抽象接口，先完成 macOS，再单独做 WinRT |
| MTU 500/517 文档矛盾 | 相机静默不响应，难以定位 | 第一阶段硬件测量并记录实际协商值，按 profile 配置 |
| Wi-Fi 切网影响用户网络 | 用户失去互联网或应用访问错误网卡 | 显示阶段、保存网络快照、探测相机地址、断开后恢复/提示 |
| BLE Write Without Response 丢帧 | 配对或取密码偶发超时 | 所有发送串行化、按命令间隔 pacing、按消息 ID 等待响应、有限重试 |
| 相机按 app identity 记忆配对 | 每次重连重复确认 | identity 每安装持久化，重试不改变 |
| 机型端口/存储/清单差异 | 某些机型连上但没有媒体 | profile 驱动，不从名称推断；未知机型只诊断 |
| 相机 AP 无互联网 | Node/HTTP/UDP 走错网卡 | 连接后主动探测本地接口和 `192.168.2.1`，必要时提供网卡选择/诊断 |
| 原始协议日志含密码 | 用户凭据泄露 | 密码永不打印；BLE/DUML 日志默认脱敏，导出诊断前再过滤 |
| 误开放删除/控制命令 | 可能破坏用户素材或设备状态 | 第一版 capability 关闭，单独设计确认、句柄和回读验证 |
| 直接复制第三方代码 | 许可证或维护边界不清 | 只移植必要代码，保留 MIT 声明和来源，记录协议参考出处 |

## 8. 评审时需要确认的问题

1. 是否确认以 Pocket 4 作为第一台基线设备、Pocket 4 Pro 作为第二台紧随验收设备？Osmosis 已有两者的硬件验证，但 P4P 的 AP 掉线恢复仍需单独覆盖。
2. 第一版是否只支持 macOS，还是必须同步支持 Windows？如果没有 Windows BLE 实机和开发环境，建议先把 Windows 标为未支持，避免做出不可验收的抽象。
3. 是否接受应用连接 DJI 时临时切换系统 Wi-Fi，并在断开后恢复原网络？这是桌面端区别于 Android `bindProcessToNetwork` 的最大产品约束。
4. 第一版是否只做“浏览、预览、下载”？建议明确关闭删除、收藏、相机控制和无人机 QuickTransfer。
5. 是否允许在设置中保存已确认的 DJI 设备信息（型号、MAC/系统标识、SSID）？密码建议不落盘，除非后续确认系统钥匙串方案。
6. 是否要求普通发行包支持 DJI？如果要求，必须先确定原生 BLE helper 的打包和签名方式，不能依赖开发机上的 Swift 工具链。

## 9. 建议的开工顺序

评审通过后按以下顺序开工：

1. 先锁定 Pocket 4，完成 BLE 广播、服务、特征、MTU 和一组脱敏抓包记录；随后补采 Pocket 4 Pro 的新格式广播和清单记录；
2. 只写 TypeScript 协议内核和 fixture 测试，不接 UI；
3. 做 macOS BLE 长连接 helper，先实现取 SSID/密码，不急着列媒体；
4. 完成 Wi-Fi handoff 和 `192.168.2.1` 探测；
5. 移植 UDP 握手和最小媒体清单，先验证 Pocket 4 的一个照片和一个视频下载，再验证 Pocket 4 Pro 的双存储清单；
6. 再接入 `CameraMediaSource`、连接页面和现有下载队列；
7. 最后扩展机型、Windows、删除和无人机能力。

当前建议的第一阶段完成定义是：**在 Pocket 4 上，用户不手工输入 Wi-Fi 密码，完成 BLE 配对确认、自动加入相机 Wi-Fi、读取双存储媒体清单并下载文件；随后在 Pocket 4 Pro 上完成新格式 BLE 识别、双存储清单和掉线恢复验收。**

## 10. 当前已落地内容

### 协议内核

- `electron/dji/djiBytes.ts`：DJI CRC8/CRC16、DUML 帧、PackString 和多帧扫描；
- `electron/dji/djiModels.ts`：Pocket 4 经典广播和 Pocket 4 Pro 新广播（`productType=218`）解析；
- `electron/dji/djiBleSession.ts`：`fff0/fff4/fff5`、`07/45`、`07/46`、`07/07`、`07/0e` 的顺序状态机，以及同协议 mock BLE 适配器；
- `electron/dji/djiUdpTransport.ts`：9004 数据链路、握手、路由头、DUML UDP 包；
- `electron/dji/djiManifest.ts`：CompositePack 路径、缩略图、句柄和双存储清单解析；
- `electron/dji/djiCameraSession.ts`：TCP-7001 poke、UDP 注册、双存储清单、HTTP HEAD/Range 媒体映射。

### Luna 接入

- 新增 `dji-pocket-4`、`dji-pocket-4-pro` 设备 profile；
- `CameraMediaSource` 已按 `dji-*` 路由到 DJI 会话；
- 设置页可切换 Pocket 4 / Pocket 4 Pro，切换时同步本地 mock 端口配置；
- Electron 开发者模式根据当前 DJI 设备自动启动 `dji_mock_server`，发行包也会携带服务脚本；
- 第一版 capability 关闭删除，只开放连接、浏览、预览和下载。

### Mock 验收服务

入口：`dji_mock_server/server.mjs`，说明：`dji_mock_server/README.md`。

服务端口默认使用本地 `HTTP 18080`、`TCP 17001`、`UDP 19004`，与真实设备的 `80/7001/9004` 分开，避免误连。`--drop-after-bytes` 可模拟 Pocket 4 Pro 下载中 AP 掉线；素材根目录包含 `sdcard/` 和 `internal/` 时会生成双存储清单。

当前仍明确保留的硬件工作：真实 macOS CoreBluetooth 长连接、系统 Wi-Fi 切换/恢复，以及 Pocket 4 Pro 真实掉线后的断点恢复。当前非 loopback 地址会给出明确错误，不会伪装成已支持的真实连接。
