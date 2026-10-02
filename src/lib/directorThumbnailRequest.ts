export function directorThumbnailRequest(url: unknown, positionMs?: unknown) {
  if (typeof url !== 'string' || !/^(https?|file):\/\//i.test(url)) throw new Error('缩略图地址无效')
  if (positionMs !== undefined && (!Number.isSafeInteger(positionMs) || Number(positionMs) < 0)) throw new Error('缩略图时间无效')
  return { url, cacheKey: positionMs === undefined ? url : `${url}\nframe=${positionMs}`,
    seekArgs: positionMs === undefined ? [] : ['-ss', String(Number(positionMs) / 1000)] }
}
