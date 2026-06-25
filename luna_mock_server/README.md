# Luna Mock Server

本地模拟 Luna 相机的两个服务，默认地址和端口来自 `electron/deviceConfigs/luna-ultra.json`：

- HTTP media index
- TCP control

启动：

```bash
npm run mock:luna -- --root "/path/to/media"
```

指定素材目录和限速：

```bash
npm run mock:luna -- --root "/path/to/media" --rate-mbps <mbps>
```

指定地址和端口：

```bash
npm run mock:luna -- --host <host> --http-port <http-port> --tcp-port <tcp-port>
```

启动后在应用设置页开启当前设备的开发者模式，再回到设备媒体库读取。HTTP 列表和文件下载会要求先经过 TCP 鉴权，下载接口支持 Range 断点续传，并按 `--rate-mbps` 限速。
