import assert from 'node:assert/strict'
import {
  buildModelArtifacts,
  loadModelRegistry,
  MODEL_RELEASE_TAG,
} from './model-resource-release.mjs'

const registry = await loadModelRegistry()
const artifacts = buildModelArtifacts(registry)
const allModels = [...registry.SEGMENTATION_MODELS, ...registry.SPECIALIZED_SEGMENTATION_MODELS, ...registry.AI_SELECTION_MODELS, ...registry.SAM_MODELS]
const gitCodePrefix = `https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/${MODEL_RELEASE_TAG}/`

assert.equal(allModels.length, 9, '当前注册表应登记 9 个生产模型')
assert.equal(artifacts.length, 10, '当前注册表应映射为 10 个 ONNX 文件')
assert.equal(new Set(artifacts.map((artifact) => artifact.fileName)).size, artifacts.length, 'Release 文件名不得重复')
assert.equal(new Set(artifacts.map((artifact) => artifact.sha256)).size, artifacts.length, '相同权重必须复用一个 Release 附件')
assert.equal(artifacts.reduce((total, artifact) => total + artifact.models.length, 0), 10, '每个模型文件角色都必须被覆盖')

for (const artifact of artifacts) {
  assert.match(artifact.fileName, /^[a-zA-Z0-9._-]+\.onnx$/)
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/)
  assert.ok(artifact.sizeBytes > 0)
  assert.ok(artifact.sourceUrls.length > 0)
  assert.ok(artifact.sourceUrls.every((url) => !url.includes('gitcode.com/')), '发布源必须是登记的原始来源')
}

for (const model of allModels) {
  const files = 'files' in model ? Object.values(model.files) : [model]
  for (const file of files) {
    const sources = [file.url, ...(file.mirrors ?? [])]
    assert.ok(sources.some((url) => url.startsWith(gitCodePrefix)), `${model.id} 的每个权重都必须登记专用 GitCode Release`)
    if (file.url.includes('modelscope.cn/')) {
      assert.equal(sources[0], file.url, `${model.id} 的 ModelScope 固定文件必须保持第一下载源`)
      assert.ok(sources[1].startsWith(gitCodePrefix), `${model.id} 的 GitCode 镜像必须紧随 ModelScope`)
    } else {
      assert.ok(file.url.startsWith(gitCodePrefix), `${model.id} 无 ModelScope 时应优先使用 GitCode`)
    }
  }
}

console.log(`model resource release tests passed (${allModels.length} models, ${artifacts.length} unique files)`)
