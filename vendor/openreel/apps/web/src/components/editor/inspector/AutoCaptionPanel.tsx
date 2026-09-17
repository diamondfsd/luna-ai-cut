import React, { useCallback, useState } from "react";
import {
  SUBTITLE_STYLE_PRESETS,
  splitCaptionIntoSingleLineCues,
  audioBufferToMonoSamples,
  type TranscriptionSegment,
} from "@openreel/core";
import {
  ToolcraftButton as Button,
  ToolcraftCard as Card,
  ToolcraftSelectControl as Selector,
  ToolcraftText as Text,
} from "@openreel/ui";
import { AlertCircle, Loader2, Sparkles } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { loadAudioBuffer } from "../../../utils/load-audio-buffer";

const CAPTION_STYLE_PRESETS = ["default", "modern", "bold", "cinematic", "minimal"] as const;

interface AutoCaptionPanelProps {
  clipId?: string;
  maxWordsPerLine?: number;
}

export const AutoCaptionPanel: React.FC<AutoCaptionPanelProps> = ({
  clipId,
  maxWordsPerLine = 5,
}) => {
  const getClip = useProjectStore((state) => state.getClip);
  const getMediaItem = useProjectStore((state) => state.getMediaItem);
  const addSubtitle = useProjectStore((state) => state.addSubtitle);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [selectedStyle, setSelectedStyle] = useState<string>("default");
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selectedItems = useUIStore((state) => state.selectedItems);
  const resolvedClipId =
    clipId ?? selectedItems.find((item) => item.type === "clip")?.id ?? "";
  const clip = getClip(resolvedClipId);
  const mediaItem = clip ? getMediaItem(clip.mediaId) : undefined;
  const canTranscribe = Boolean(
    clip && mediaItem && (mediaItem.type === "video" || mediaItem.type === "audio"),
  );

  const handleTranscribe = useCallback(async () => {
    if (!clip || !mediaItem) return;
    setError(null);
    setSegments([]);
    setIsTranscribing(true);
    setProgress(0);
    setProgressMessage("Extracting selected clip audio…");

    let audioContext: AudioContext | null = null;
    try {
      const sourceBlob =
        mediaItem.blob ??
        (mediaItem.fileHandle ? await mediaItem.fileHandle.getFile() : null);
      if (!sourceBlob) {
        throw new Error("Reconnect the source media before creating captions.");
      }
      audioContext = new AudioContext();
      const audioBuffer = await loadAudioBuffer(audioContext, sourceBlob, {
        audioTrackIndex: clip.audioTrackIndex,
        onProgress: (next) => {
          setProgress(next.progress * 0.2);
          setProgressMessage(next.message);
        },
      });
      if (!audioBuffer) throw new Error("The selected clip audio could not be decoded.");

      const sourceStart = Math.max(0, clip.inPoint ?? 0);
      const sourceEnd = Math.min(
        audioBuffer.duration,
        clip.outPoint > sourceStart
          ? clip.outPoint
          : sourceStart + clip.duration * Math.max(clip.speed ?? 1, 0.01),
      );
      if (sourceEnd <= sourceStart) throw new Error("The selected clip has no audio range.");

      const lunaMedia = window.openreel?.lunaMedia;
      if (typeof lunaMedia?.transcribeAudioSamples !== "function") {
        throw new Error("Native Sherpa transcription is unavailable in this editor.");
      }
      setProgress(0.2);
      setProgressMessage("Transcribing with native Sherpa…");
      const result = await lunaMedia.transcribeAudioSamples(
        audioBufferToMonoSamples(audioBuffer, sourceStart, sourceEnd),
      );
      const sourceDuration = Math.max(0.1, sourceEnd - sourceStart);
      const playbackSpeed = Math.max(clip.speed ?? 1, 0.01);
      const clipEndTime = clip.startTime + clip.duration;
      const nextSegments: TranscriptionSegment[] = result.cues
        .map((cue) => {
          const start = Math.max(0, cue.startMs / 1_000);
          const end = Math.min(sourceDuration, cue.endMs / 1_000);
          return {
            text: cue.text.trim(),
            startTime: Math.min(clipEndTime, clip.startTime + start / playbackSpeed),
            endTime: Math.min(
              clipEndTime,
              clip.startTime + Math.max(start + 0.1, end) / playbackSpeed,
            ),
            confidence: 1,
          };
        })
        .filter(
          (segment) =>
            segment.text.length > 0 && segment.endTime > segment.startTime,
        );
      if (nextSegments.length === 0) {
        throw new Error("No speech was detected in the selected clip.");
      }
      setSegments(nextSegments);
      setProgress(1);
      setProgressMessage("Captions are ready to add");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Local transcription failed.");
    } finally {
      await audioContext?.close().catch(() => undefined);
      setIsTranscribing(false);
    }
  }, [clip, mediaItem]);

  const handleAddToTimeline = useCallback(async () => {
    if (!clip || segments.length === 0) return;
    const style = SUBTITLE_STYLE_PRESETS[selectedStyle] ?? SUBTITLE_STYLE_PRESETS.default;
    let addedCount = 0;
    for (const segment of segments) {
      const cues = splitCaptionIntoSingleLineCues(
        segment.text,
        segment.startTime,
        segment.endTime,
        maxWordsPerLine,
      );
      for (const cue of cues) {
        await addSubtitle(
          {
            id: `sherpa-${crypto.randomUUID()}`,
            text: cue.text,
            startTime: cue.startTime,
            endTime: cue.endTime,
            style,
          },
          {
            captionSource: "sherpa",
            captionSourceClipId: clip.id,
            captionMaxWordsPerLine: maxWordsPerLine,
          },
        );
        addedCount += 1;
      }
    }
    setSegments([]);
    setProgressMessage(`${addedCount} single-line caption clips added`);
  }, [addSubtitle, clip, maxWordsPerLine, segments, selectedStyle]);

  return (
    <div className="w-full min-w-0 space-y-3">
      <Card variant="muted" padding={3} className="space-y-2 border border-primary/30 bg-primary/5">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-primary" aria-hidden />
          <div className="min-w-0">
            <Text type="supporting" weight="bold" className="block text-[11px] text-fg">
              Native Sherpa captions
            </Text>
            <Text type="supporting" color="secondary" className="block text-[9px]">
              Chinese speech recognition runs through the desktop editor.
            </Text>
          </div>
        </div>
      </Card>

      <Card variant="muted" padding={3} className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Text type="supporting" color="secondary" className="text-[10px]">Caption style</Text>
          <Selector
            label="Caption style"
            isLabelHidden
            size="sm"
            width={132}
            value={selectedStyle}
            onChange={setSelectedStyle}
            isDisabled={isTranscribing}
            options={CAPTION_STYLE_PRESETS.map((preset) => ({
              label: preset[0].toUpperCase() + preset.slice(1),
              value: preset,
            }))}
          />
        </div>
      </Card>

      {error && (
        <Card variant="muted" padding={2} className="flex items-start gap-2 border border-red-500/30 bg-red-500/10">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" aria-hidden />
          <Text type="supporting" className="text-[10px] text-red-400">{error}</Text>
        </Card>
      )}

      {isTranscribing && (
        <Card variant="muted" padding={3} className="space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-primary" aria-hidden />
            <Text type="supporting" color="secondary" className="text-[10px]">
              {progressMessage}
            </Text>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-2">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.max(3, Math.min(100, progress * 100))}%` }}
            />
          </div>
        </Card>
      )}

      {segments.length > 0 && (
        <div className="space-y-2">
          <div className="max-h-36 space-y-1 overflow-y-auto">
            {segments.map((segment, index) => (
              <Card key={`${segment.startTime}-${index}`} variant="muted" padding={2} className="text-[10px]">
                <span className="font-mono text-fg-muted">{segment.startTime.toFixed(1)}s</span>
                <span className="ml-2 text-fg">{segment.text}</span>
              </Card>
            ))}
          </div>
          <Button
            label={`Add ${segments.length} as Editable Text`}
            variant="primary"
            size="sm"
            onClick={handleAddToTimeline}
            className="w-full justify-center"
          />
        </div>
      )}

      <Button
        label={isTranscribing ? "Transcribing Locally…" : "Transcribe Selected Clip"}
        icon={
          isTranscribing ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <Sparkles size={14} aria-hidden />
          )
        }
        variant="primary"
        size="md"
        onClick={handleTranscribe}
        isDisabled={!canTranscribe || isTranscribing}
        className="w-full justify-center"
      />
      {!canTranscribe && (
        <Text type="supporting" color="secondary" className="block text-center text-[9px]">
          Select a connected video or audio clip first.
        </Text>
      )}
    </div>
  );
};

export default AutoCaptionPanel;
