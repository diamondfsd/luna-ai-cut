# DJI Pocket 4 / 4 Pro Mock Service

该服务模拟 Osmosis 中 Pocket 4 系列的验收链路：

- HTTP `/v2?storage=...&path=...`，支持 `HEAD`、Range 和断点下载；
- UDP DUML `9004`（本地默认 `19004`）；
- TCP `7001` poke（本地默认 `17001`）；
- `/ble/advertisement` 提供 Pocket 3、Pocket 4 和 Pocket 4 Pro 三种 BLE 广播样本；
- `/ble/state` 暴露脱敏的配对状态，不返回 Wi-Fi 密码；
- `0x00/0x26 -> 0x00/0x27` CompositePack 双存储清单；
- `--drop-after-bytes` 模拟 Pocket 4 Pro 传输过程中 AP 掉线。

直接运行：

```bash
pnpm mock:dji -- --model pocket4 --root /path/to/media
pnpm mock:dji -- --model pocket4pro --root /path/to/media --drop-after-bytes 1048576
pnpm mock:dji -- --model pocket3 --root /path/to/media
```

素材目录如果包含 `sdcard/` 和 `internal/` 子目录，会分别映射到两个存储；没有子目录时，Pocket 3 全部映射到 SD 卡，Pocket 4 全部映射到内置存储。启动日志是 JSON 行，包含文件数量和端口，不输出 Wi-Fi 密码。

Luna 开发者模式选择对应的 DJI 设备后，使用本地 mock 地址连接。Electron 内置的 mock 启动入口会根据当前 DJI 设备自动启动此服务。
