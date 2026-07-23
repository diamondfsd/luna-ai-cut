# ONNX 模型资源规范

Luna AI Cut 的 ONNX 权重不提交到代码仓库，也不打入安装包。所有随应用登记的权重必须镜像到独立的 GitCode Model Release，并保留可审计的原始来源、版本、许可证、文件大小和 SHA256。

## 下载顺序

1. ModelScope 存在完全相同的固定文件时，ModelScope 为第一下载源。
2. GitCode Model Release 为第二下载源；没有 ModelScope 固定文件时为第一下载源。
3. 境外官方上游作为最后回退源。

不同下载源必须指向大小和 SHA256 完全一致的文件。不得为了命中国内下载源而替换模型版本或权重。

## Release 约定

- 仓库：`diamondfsd/luna-ai-cut-package-release`
- Tag：`model-resources-v<清单版本>`
- 当前 Tag：`model-resources-v1.0.0`
- 清单：`model-resources-v1.0.0.json`
- 单文件模型：`<model-id>.onnx`
- SAM 编码器：`<model-id>-vision-encoder.onnx`
- 内容完全相同的权重只上传一次，多模型通过清单共同引用。

Release 附件必须由模型注册表中的非 GitCode 源地址下载。发布流程会先校验登记大小和 SHA256，上传后再从 GitCode 回读并执行同样校验；任一步失败都视为发布失败。

## 维护流程

1. 在 `src/shared/segmentationModels.ts` 登记模型来源、固定版本、许可证、大小与 SHA256。
2. 为每个文件加入当前 GitCode Model Release URL，并遵守下载顺序。
3. 运行 `pnpm test:model-resources`，确保应用注册表与发布清单完整对应。
4. 运行 `pnpm publish:models`。命令默认读取已忽略的 `scripts/deploy-release.conf`，优先按 SHA256 复用应用模型缓存，缺失文件再从登记源断点续传到 `release/model-resources/`，并上传、回读校验。
5. 检查生成清单和命令输出，确认每个附件均显示 `verified`。

新增、升级或移除模型时必须发布新的清单版本和 Release Tag，旧 Release 保留，保证已发布客户端仍可下载。许可证文件与必要声明应随正式发行资源提供；模型代码、权重或训练数据许可不清楚时不得发布。
