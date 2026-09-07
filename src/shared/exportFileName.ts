export function exportNameKey(name: string): string {
  return name.toLocaleLowerCase()
}

export function allocateExportFileName(desiredName: string, usedNames: Iterable<string>): string {
  const used = new Set([...usedNames].map(exportNameKey))
  if (!used.has(exportNameKey(desiredName))) return desiredName

  const extensionIndex = desiredName.lastIndexOf('.')
  const extension = extensionIndex > 0 ? desiredName.slice(extensionIndex) : ''
  const baseName = extension ? desiredName.slice(0, extensionIndex) : desiredName
  for (let index = 1; index <= 1000; index += 1) {
    const candidate = `${baseName} (${index})${extension}`
    if (!used.has(exportNameKey(candidate))) return candidate
  }
  throw new Error('导出目录中存在过多同名文件')
}

export function createExportNameAllocator(existingNames: Iterable<string>): (desiredName: string) => string {
  const usedNames = new Set([...existingNames].map(exportNameKey))
  return (desiredName: string): string => {
    const allocated = allocateExportFileName(desiredName, usedNames)
    usedNames.add(exportNameKey(allocated))
    return allocated
  }
}
