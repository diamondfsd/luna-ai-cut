import { bundledHdcBinary, createHdcForward, createHdcRunner, parseHdcTargets, removeHdcForward } from './harmonyHdcClient.ts'
import { ForwardTcpReceiver, type ForwardReceiverDependencies } from './forwardTcpReceiver.ts'
import type { UsbMediaFrame } from './usbAoaProtocol.ts'

export class HarmonyHdcReceiver extends ForwardTcpReceiver {
  constructor(onFrame: (frame: UsbMediaFrame) => void, onDisconnected: () => void = () => {}, dependencies: Partial<ForwardReceiverDependencies> = {}) {
    const binary = bundledHdcBinary()
    super(onFrame, onDisconnected, {
      transport: 'harmony-hdc', label: 'Harmony HDC', phoneLabel: '鸿蒙手机', available: Boolean(binary),
      run: binary ? createHdcRunner(binary) : async () => { throw new Error('手机连接工具缺失') },
      devices: async (run, signal) => parseHdcTargets(await run(['list', 'targets', '-v'], signal)),
      createForward: createHdcForward, removeForward: removeHdcForward,
    }, dependencies)
  }
}
