import React, { useEffect, useRef } from "react";
import {
  Monitor,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Camera,
  Circle,
  Settings,
  AlertCircle,
} from "@/icons/lucide-compat";
import { useRecorderStore } from "../../stores/recorder-store";
import {
  ScreenRecorderService,
  type VideoResolution,
  type FrameRate,
  type WebcamResolution,
} from "../../services/screen-recorder";
import { RecordingCountdown } from "./RecordingCountdown";
import { RecordingControls } from "./RecordingControls";
import { ToolcraftSwitchControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";

interface ScreenRecorderProps {
  isOpen: boolean;
  onClose: () => void;
  onRecordingComplete: (screenBlob: Blob, webcamBlob?: Blob) => void;
}

const RESOLUTION_OPTIONS: {
  value: VideoResolution;
  label: string;
  desc: string;
}[] = [
  { value: "720p", label: "720p 高清", desc: "1280×720 - 文件体积较小" },
  { value: "1080p", label: "1080p 全高清", desc: "1920×1080 - 推荐" },
  { value: "1440p", label: "1440p QHD", desc: "2560×1440 - 高质量" },
  { value: "4k", label: "4K 超高清", desc: "3840×2160 - 最高质量" },
];

const FRAMERATE_OPTIONS: { value: FrameRate; label: string }[] = [
  { value: 30, label: "30 fps" },
  { value: 60, label: "60 fps" },
];

const WEBCAM_RESOLUTION_OPTIONS: { value: WebcamResolution; label: string }[] =
  [
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
  ];

export const ScreenRecorder: React.FC<ScreenRecorderProps> = ({
  isOpen,
  onClose,
  onRecordingComplete,
}) => {
  const {
    status,
    options,
    webcamStream,
    error,
    setVideoOption,
    setAudioOption,
    setWebcamOption,
    requestPermissions,
    startRecording,
    stopRecording,
    cancelRecording,
    pauseRecording,
    resumeRecording,
    reset,
  } = useRecorderStore();

  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const isSupported = ScreenRecorderService.isSupported();
  const features = ScreenRecorderService.getSupportedFeatures();

  useEffect(() => {
    if (webcamVideoRef.current && webcamStream) {
      webcamVideoRef.current.srcObject = webcamStream;
    }
  }, [webcamStream]);

  useEffect(() => {
    if (!isOpen) {
      if (status === "idle" || status === "error") {
        reset();
      }
    }
  }, [isOpen, status, reset]);

  const handleStartRecording = async () => {
    const hasPermissions = await requestPermissions();
    if (hasPermissions) {
      await startRecording();
    }
  };

  const handleStopRecording = async () => {
    const result = await stopRecording();
    if (result) {
      onRecordingComplete(result.screenBlob, result.webcamBlob);
      onClose();
    }
  };

  const handleCancel = () => {
    cancelRecording();
    onClose();
  };

  if (!isOpen) return null;

  if (status === "countdown") {
    return <RecordingCountdown />;
  }

  if (status === "recording" || status === "paused") {
    return (
      <RecordingControls
        onStop={handleStopRecording}
        onPause={pauseRecording}
        onResume={resumeRecording}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <Dialog isOpen onOpenChange={(open) => !open && handleCancel()} width={672} purpose="form">
      <Layout
        header={
          <DialogHeader
            title="屏幕录制"
            onOpenChange={(open) => !open && handleCancel()}
            startContent={<Circle size={20} className="text-error fill-error animate-pulse" aria-hidden />}
          />
        }
        content={
          <LayoutContent className="space-y-6">
          {!isSupported && (
            <Card variant="muted" padding={4} className="flex items-start gap-3 border border-error/30 bg-error/10">
              <AlertCircle
                size={20}
                className="text-error flex-shrink-0 mt-0.5"
                aria-hidden
              />
              <div>
                <Text type="body" weight="bold" display="block" className="text-error">
                  当前环境不支持屏幕录制
                </Text>
                <Text type="supporting" color="secondary" display="block" className="mt-1">
                  当前浏览器不支持屏幕录制，请使用 Chrome、Edge 或 Firefox。
                </Text>
              </div>
            </Card>
          )}

          {error && (
            <Card variant="muted" padding={4} className="flex items-start gap-3 border border-error/30 bg-error/10">
              <AlertCircle
                size={20}
                className="text-error flex-shrink-0 mt-0.5"
                aria-hidden
              />
              <div>
                <Text type="body" weight="bold" display="block" className="text-error">
                  录制错误
                </Text>
                <Text type="supporting" color="secondary" display="block" className="mt-1">
                  {error}
                </Text>
              </div>
            </Card>
          )}

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Monitor size={16} aria-hidden />
              <Text type="body" weight="bold">
                视频设置
              </Text>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Selector
                  label="分辨率"
                  value={options.video.resolution}
                  onChange={(value) => setVideoOption("resolution", value as VideoResolution)}
                  isDisabled={!isSupported}
                  options={RESOLUTION_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: opt.label,
                  }))}
                  size="sm"
                  width="100%"
                />
                <Text type="supporting" color="secondary" display="block" className="mt-1 text-[10px]">
                  {
                    RESOLUTION_OPTIONS.find(
                      (o) => o.value === options.video.resolution,
                    )?.desc
                  }
                </Text>
              </div>

              <div>
                <Selector
                  label="帧率"
                  value={String(options.video.frameRate)}
                  onChange={(value) => setVideoOption("frameRate", parseInt(value, 10) as FrameRate)}
                  isDisabled={!isSupported}
                  options={FRAMERATE_OPTIONS.map((opt) => ({
                    value: String(opt.value),
                    label: opt.label,
                  }))}
                  size="sm"
                  width="100%"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Settings size={16} aria-hidden />
              <Text type="body" weight="bold">
                音频设置
              </Text>
            </div>

            <div className="flex gap-4">
              <SelectableCard
                label="系统音频"
                isSelected={options.audio.systemAudio}
                onChange={() => setAudioOption("systemAudio", !options.audio.systemAudio)}
                isDisabled={!isSupported || !features.systemAudio}
                padding={3}
                variant={options.audio.systemAudio ? "green" : "muted"}
                className="flex-1"
              >
                {options.audio.systemAudio ? (
                  <Volume2 size={18} aria-hidden />
                ) : (
                  <VolumeX size={18} aria-hidden />
                )}
                <Text type="body" className="ml-2 text-sm">
                  系统音频
                </Text>
              </SelectableCard>

              <SelectableCard
                label="麦克风"
                isSelected={options.audio.microphone}
                onChange={() => setAudioOption("microphone", !options.audio.microphone)}
                isDisabled={!isSupported}
                padding={3}
                variant={options.audio.microphone ? "green" : "muted"}
                className="flex-1"
              >
                {options.audio.microphone ? (
                  <Mic size={18} aria-hidden />
                ) : (
                  <MicOff size={18} aria-hidden />
                )}
                <Text type="body" className="ml-2 text-sm">
                  麦克风
                </Text>
              </SelectableCard>
            </div>

            {!features.systemAudio && (
              <Text type="supporting" color="secondary" display="block" className="text-[10px]">
                仅 Chrome 和 Edge 浏览器支持系统音频采集。
              </Text>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera size={16} aria-hidden />
                <Text type="body" weight="bold">
                  摄像头录制
                </Text>
              </div>
              <ToolcraftSwitchControl
                ariaLabel="摄像头录制"
                checked={options.webcam.enabled}
                onCheckedChange={(enabled) => setWebcamOption("enabled", enabled)}
                disabled={!isSupported || !features.webcam}
                showLabel={false}
              />
            </div>

            {options.webcam.enabled && (
              <div className="flex gap-4">
                <div className="flex-1">
                  <Selector
                    label="摄像头分辨率"
                    value={options.webcam.resolution}
                    onChange={(value) => setWebcamOption("resolution", value as WebcamResolution)}
                    options={WEBCAM_RESOLUTION_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: opt.label,
                    }))}
                    size="sm"
                    width="100%"
                  />
                </div>

                {webcamStream && (
                  <div className="w-32 h-24 bg-background-tertiary rounded-lg overflow-hidden border border-border">
                    <video
                      ref={webcamVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
              </div>
            )}

            <Text type="supporting" color="secondary" display="block" className="text-[10px]">
              摄像头内容会作为单独文件录制，方便在编辑器中自由调整。
            </Text>
          </div>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex items-center justify-between gap-4">
              <Text type="supporting" color="secondary" className="text-xs">
                录制将在 3 秒倒计时后开始
              </Text>

              <div className="flex gap-3">
                <Button
                  label="取消"
                  variant="ghost"
                  onClick={handleCancel}
                />
                <Button
                  label={status === "requesting" ? "正在请求权限..." : "开始录制"}
                  variant="primary"
                  icon={
                    status === "requesting" ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    ) : (
                      <Circle size={14} className="fill-current" aria-hidden />
                    )
                  }
                  onClick={handleStartRecording}
                  isDisabled={!isSupported || status === "requesting"}
                  className="bg-red-600 font-bold text-white hover:bg-red-700"
                />
              </div>
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};
