# CPU ONNX 模型回归

运行 `pnpm test:onnx:cpu`，使用应用的 CPU 会话初始化入口验证本地全部模型。

测试先核对文件 SHA256，再逐模型隔离进程，执行两次推理并检查输出非空、浮点结果有限。涵盖图像、SAM、修复、语音分段、字幕与标点模型。报告保存在 `test-results/onnx-cpu/`。

默认读取当前系统的应用模型目录，不下载或修改模型。可使用 `--models <目录>`、`--model <模型ID>` 和 `--runtime <运行库>` 指定资源。macOS 和 Windows 均只使用 CPU；须分别在对应系统执行。
