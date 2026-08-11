export function createMediaFileHandle(file: File): FileSystemFileHandle {
  const handle = {
    kind: 'file',
    name: file.name,
    getFile: async () => file,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    isSameEntry: async (other: FileSystemHandle) => other === handle,
  }

  return handle as unknown as FileSystemFileHandle
}
