import { generateUUID } from "@/utils/id";
import { DEFAULT_TRANSCRIPTION_SAMPLE_RATE } from "@/transcription/audio";
import type {
	TranscriptionLanguage,
	TranscriptionProgress,
	TranscriptionResult,
} from "@/transcription/types";

type ProgressCallback = (progress: TranscriptionProgress) => void;

class TranscriptionService {
	private activeRequestId: string | null = null;

	async transcribe({
		audioData,
		language = "auto",
		onProgress,
	}: {
		audioData: Float32Array;
		language?: TranscriptionLanguage;
		onProgress?: ProgressCallback;
	}): Promise<TranscriptionResult> {
		const requestId = generateUUID();
		this.activeRequestId = requestId;
		const unsubscribe = window.luna.onWorkspaceSubtitleProgress((progress) => {
			if (progress.requestId !== requestId) return;
			onProgress?.({
				status: progress.phase === "model" ? "loading-model" : "transcribing",
				progress: progress.percent ?? 0,
				message: progress.label,
			});
		});

		try {
			const result = await window.luna.workspace.transcribeOpenCutAudio({
				requestId,
				samples: audioData,
				sampleRate: DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
				language: language === "auto" || language === "zh" || language === "en"
					? language
					: "auto",
			});
			return {
				text: result.cues.map((cue) => cue.text).join(" "),
				segments: result.cues.map((cue) => ({
					text: cue.text,
					start: cue.startMs / 1_000,
					end: cue.endMs / 1_000,
				})),
				language: result.language,
			};
		} finally {
			unsubscribe();
			if (this.activeRequestId === requestId) this.activeRequestId = null;
		}
	}

	cancel() {
		if (!this.activeRequestId) return;
		void window.luna.workspace.cancelSubtitleTranscription(this.activeRequestId);
	}

	terminate() {
		this.cancel();
		this.activeRequestId = null;
	}
}

export const transcriptionService = new TranscriptionService();
