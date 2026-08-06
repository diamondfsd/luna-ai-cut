import type { TextItem } from '@freecut/types/timeline'
import type { ResolvedTransform } from '@freecut/types/transform'
import { expandTextTransformToFitContent } from '@freecut/features/preview/deps/composition-runtime'
import type { ItemPropertiesPreview } from '../stores/gizmo-store'

/**
 * Preview wrapper around the shared text-fit helper so property drag previews
 * can expand bounds before the item itself is committed.
 */
export function expandTextTransformForPreview(
  item: TextItem,
  transform: ResolvedTransform,
  previewProperties?: ItemPropertiesPreview,
): ResolvedTransform {
  return expandTextTransformToFitContent(item, transform, previewProperties)
}
