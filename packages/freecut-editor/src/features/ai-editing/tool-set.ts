import { listAiEditingTools } from './tool-registry'

/** Immutable tool selection for one model turn. All definitions are available immediately. */
export class AiEditingToolSet {
  readonly availableToolIds: ReadonlySet<string>

  constructor(allowedToolIds?: ReadonlySet<string>) {
    const toolIds = new Set(
      listAiEditingTools()
        .filter((tool) => !allowedToolIds || allowedToolIds.has(tool.id))
        .map((tool) => tool.id),
    )
    this.availableToolIds = toolIds
  }
}
