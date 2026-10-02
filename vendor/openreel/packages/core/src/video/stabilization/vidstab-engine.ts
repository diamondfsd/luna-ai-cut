/** Read-only compatibility boundary after removal of the OpenReel-hosted vidstab runtime. */
export class VidstabEngine {
  hasStabilized(_clipId: string): boolean { return false; }
  getStabilizedBlob(_clipId: string): Blob | null { return null; }
  dispose(): void {}
}
const instance = new VidstabEngine();
export function getVidstabEngine(): VidstabEngine { return instance; }
export function disposeVidstabEngine(): void { instance.dispose(); }
