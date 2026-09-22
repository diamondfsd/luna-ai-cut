import AudioToolbox
import CoreAudio
import Foundation

final class LunaAudioRenderer {
    private static let sinkUID = "LunaVirtualMicrophoneSink_UID"
    private static let sampleRate: Double = 48_000
    private static let channelCount = 2
    private static let ringFrames = 960_000
    private static let maxBufferedFrames = 518_400

    private let lock = NSLock()
    private var outputUnit: AudioUnit?
    private var ring = [Float](repeating: 0, count: ringFrames * channelCount)
    private var readFrame = 0
    private var writeFrame = 0
    private var bufferedFrames = 0
    private var delayFrames = 0
    private var initialOffsetApplied = false
    private var framesToDrop = 0

    func setDelay(milliseconds: Int) {
        let clamped = max(-10_000, min(10_000, milliseconds))
        lock.lock()
        delayFrames = Int(Self.sampleRate * Double(clamped) / 1_000)
        readFrame = 0
        writeFrame = 0
        bufferedFrames = 0
        initialOffsetApplied = false
        framesToDrop = 0
        lock.unlock()
    }

    func enqueuePCM16(_ data: Data, sampleRate: Int, channels: Int, sampleCount: Int) {
        guard !data.isEmpty, sampleRate > 0, channels > 0, sampleCount > 0 else { return }
        ensureOutputStarted()

        let sourceFrames = sampleCount
        let outputFrames = sampleRate == Int(Self.sampleRate)
            ? sourceFrames
            : Int((Double(sourceFrames) * Self.sampleRate / Double(sampleRate)).rounded())

        data.withUnsafeBytes { rawBytes in
            let samples = rawBytes.bindMemory(to: Int16.self)
            lock.lock()
            defer { lock.unlock() }
            applyInitialOffsetIfNeeded()

            var outputIndex = 0
            while outputIndex < outputFrames {
                let sourceOffset = Double(outputIndex) * Double(sampleRate) / Self.sampleRate
                let sourceIndex = min(sourceFrames - 1, Int(sourceOffset))
                let base = sourceIndex * channels
                let left = Float(samples[base]) / 32_768
                let right = channels > 1 ? Float(samples[base + 1]) / 32_768 : left
                appendFrame(left: left, right: right)
                outputIndex += 1
            }

            if bufferedFrames > Self.maxBufferedFrames {
                let excess = bufferedFrames - Self.maxBufferedFrames
                readFrame = (readFrame + excess) % Self.ringFrames
                bufferedFrames -= excess
            }
        }
    }

    func stop() {
        if let outputUnit {
            AudioOutputUnitStop(outputUnit)
            AudioUnitUninitialize(outputUnit)
            AudioComponentInstanceDispose(outputUnit)
        }
        outputUnit = nil
        lock.lock()
        readFrame = 0
        writeFrame = 0
        bufferedFrames = 0
        initialOffsetApplied = false
        framesToDrop = 0
        lock.unlock()
    }

    private func applyInitialOffsetIfNeeded() {
        guard !initialOffsetApplied else { return }
        initialOffsetApplied = true
        if delayFrames > 0 {
            for _ in 0..<delayFrames { appendFrame(left: 0, right: 0) }
        } else if delayFrames < 0 {
            framesToDrop = -delayFrames
        }
    }

    private func appendFrame(left: Float, right: Float) {
        if framesToDrop > 0 {
            framesToDrop -= 1
            return
        }
        let offset = writeFrame * Self.channelCount
        ring[offset] = left
        ring[offset + 1] = right
        writeFrame = (writeFrame + 1) % Self.ringFrames
        if bufferedFrames < Self.ringFrames { bufferedFrames += 1 }
    }

    private func ensureOutputStarted() {
        guard outputUnit == nil else { return }
        guard let sink = Self.deviceID(forUID: Self.sinkUID) else { return }

        var description = AudioComponentDescription(
            componentType: kAudioUnitType_Output,
            componentSubType: kAudioUnitSubType_HALOutput,
            componentManufacturer: kAudioUnitManufacturer_Apple,
            componentFlags: 0,
            componentFlagsMask: 0
        )
        guard let component = AudioComponentFindNext(nil, &description) else { return }

        var unit: AudioUnit?
        guard AudioComponentInstanceNew(component, &unit) == noErr, let unit else { return }

        var deviceID = sink
        var format = AudioStreamBasicDescription(
            mSampleRate: Self.sampleRate,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked | kAudioFormatFlagIsNonInterleaved,
            mBytesPerPacket: UInt32(MemoryLayout<Float>.size),
            mFramesPerPacket: 1,
            mBytesPerFrame: UInt32(MemoryLayout<Float>.size),
            mChannelsPerFrame: UInt32(Self.channelCount),
            mBitsPerChannel: 32,
            mReserved: 0
        )
        var callback = AURenderCallbackStruct(
            inputProc: Self.renderCallback,
            inputProcRefCon: Unmanaged.passUnretained(self).toOpaque()
        )

        guard AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &deviceID, UInt32(MemoryLayout<AudioDeviceID>.size)) == noErr,
              AudioUnitSetProperty(unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &format, UInt32(MemoryLayout<AudioStreamBasicDescription>.size)) == noErr,
              AudioUnitSetProperty(unit, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &callback, UInt32(MemoryLayout<AURenderCallbackStruct>.size)) == noErr,
              AudioUnitInitialize(unit) == noErr,
              AudioOutputUnitStart(unit) == noErr else {
            AudioComponentInstanceDispose(unit)
            return
        }
        outputUnit = unit
    }

    private func render(frameCount: UInt32, buffers: UnsafeMutablePointer<AudioBufferList>) -> OSStatus {
        let list = UnsafeMutableAudioBufferListPointer(buffers)
        guard list.count >= Self.channelCount else { return noErr }

        lock.lock()
        defer { lock.unlock() }
        let frames = Int(frameCount)
        let output = frames <= bufferedFrames ? frames : bufferedFrames

        for channel in 0..<Self.channelCount {
            guard let pointer = list[channel].mData?.assumingMemoryBound(to: Float.self) else { continue }
            for frame in 0..<frames {
                pointer[frame] = frame < output
                    ? ring[((readFrame + frame) % Self.ringFrames) * Self.channelCount + channel]
                    : 0
            }
        }
        readFrame = (readFrame + output) % Self.ringFrames
        bufferedFrames -= output
        return noErr
    }

    private static func deviceID(forUID uid: String) -> AudioObjectID? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslateUIDToDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var value = uid as CFString
        var device = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = withUnsafeMutablePointer(to: &value) { pointer in
            AudioObjectGetPropertyData(
                AudioObjectID(kAudioObjectSystemObject),
                &address,
                UInt32(MemoryLayout<CFString>.size),
                pointer,
                &size,
                &device
            )
        }
        return status == noErr && device != AudioObjectID(kAudioObjectUnknown) ? device : nil
    }

    private static let renderCallback: AURenderCallback = { refCon, _, _, _, frameCount, bufferList in
        guard let bufferList else { return noErr }
        let renderer = Unmanaged<LunaAudioRenderer>.fromOpaque(refCon).takeUnretainedValue()
        return renderer.render(frameCount: frameCount, buffers: bufferList)
    }
}
