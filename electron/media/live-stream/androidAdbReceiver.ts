import { bundledAdbBinary, createAdbForward, createAdbRunner, parseAdbDevices, removeAdbForward } from './androidAdbClient.ts'
import { ForwardTcpReceiver, type ForwardReceiverDependencies } from './forwardTcpReceiver.ts'
import type { UsbMediaFrame } from './usbAoaProtocol.ts'

export class AndroidAdbReceiver extends ForwardTcpReceiver {
  constructor(onFrame: (frame: UsbMediaFrame) => void, onDisconnected: () => void = () => {}, dependencies: Partial<ForwardReceiverDependencies> = {}) {
    const binary = bundledAdbBinary()
    super(onFrame, onDisconnected, {
      transport: 'android-adb', label: 'Android ADB', phoneLabel: '安卓手机', available: Boolean(binary),
      run: binary ? createAdbRunner(binary) : async () => { throw new Error('手机连接工具缺失') },
      devices: async (run, signal) => parseAdbDevices(await run(['devices', '-l'], signal)),
      createForward: createAdbForward, removeForward: removeAdbForward,
    }, dependencies)
  }
}
