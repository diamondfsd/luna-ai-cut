export interface AiEditorFileFilter {
  name: string
  extensions: string[]
}

export interface AiEditorFileDialogOptions {
  defaultPath?: string
  filters?: AiEditorFileFilter[]
}

export interface AiEditorFileApi {
  showSaveDialog(options: AiEditorFileDialogOptions): Promise<string | null>
  showOpenDialog(options: AiEditorFileDialogOptions): Promise<string | null>
  readFile(filePath: string): Promise<string>
  readFileBytes(filePath: string): Promise<ArrayBuffer>
  tempFilePath(extension: string): Promise<string>
  writeFile(filePath: string, data: string): Promise<void>
  openWrite(filePath: string): Promise<string>
  writeChunk(handleId: string, data: ArrayBuffer | Uint8Array, position: number): Promise<void>
  closeWrite(handleId: string): Promise<void>
  abortWrite(handleId: string): Promise<void>
  revealInFolder(filePath: string): Promise<void>
}
