import vertex from '../../luna-render-core/src/shaders/vertex.wgsl?raw'
import params from '../../luna-render-core/src/shaders/params.wgsl?raw'
import common from '../../luna-render-core/src/shaders/common.wgsl?raw'
import detail from '../../luna-render-core/src/shaders/detail.wgsl?raw'
import curve from '../../luna-render-core/src/shaders/curve.wgsl?raw'
import color from '../../luna-render-core/src/shaders/color.wgsl?raw'
import pixelFlow from '../../luna-render-core/src/shaders/pixel_flow.wgsl?raw'
import fragment from '../../luna-render-core/src/shaders/fragment.wgsl?raw'

/** The browser backend intentionally uses the same shader source as Rust/wgpu. */
export const WEBGPU_COMPOSITOR_SHADER = [
  vertex,
  params,
  common,
  detail,
  curve,
  color,
  pixelFlow,
  fragment,
].join('\n')
