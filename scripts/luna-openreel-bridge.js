(() => {
  const parentApi = () => {
    const parentWindow = window.parent
    const api = parentWindow !== window ? parentWindow.luna?.aiEditor : undefined
    if (!api) throw new Error('Luna 文件服务不可用')
    return api
  }

  // OpenReel only checks for fs to enable native project and export storage.
  // Keeping platform unset leaves the editor in its regular web UI.
  window.openreel = Object.assign(window.openreel || {}, {
    fs: {
      showSaveDialog: (options) => parentApi().showSaveDialog(options),
      showOpenDialog: (options) => parentApi().showOpenDialog(options),
      readFile: (filePath) => parentApi().readFile(filePath),
      readFileBytes: (filePath) => parentApi().readFileBytes(filePath),
      tempFilePath: (extension) => parentApi().tempFilePath(extension),
      writeFile: (filePath, data) => parentApi().writeFile(filePath, data),
      openWrite: (filePath) => parentApi().openWrite(filePath),
      writeChunk: (handleId, data, position) => parentApi().writeChunk(handleId, data, position),
      closeWrite: (handleId) => parentApi().closeWrite(handleId),
      abortWrite: (handleId) => parentApi().abortWrite(handleId),
      revealInFolder: (filePath) => parentApi().revealInFolder(filePath),
    },
  })
})()
