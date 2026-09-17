import { create } from "zustand";
import {
  screenRecorderService,
  DEFAULT_RECORDING_OPTIONS,
  type RecordingOptions,
  type RecordingStatus,
  type RecordingResult,
} from "../services/screen-recorder";

interface RecorderState {
  status: RecordingStatus;
  duration: number;
  error: string | null;
  options: RecordingOptions;
  screenStream: MediaStream | null;
  webcamStream: MediaStream | null;
  result: RecordingResult | null;
  isModalOpen: boolean;
  isControlsMinimized: boolean;

  setOptions: (options: Partial<RecordingOptions>) => void;
  setVideoOption: <K extends keyof RecordingOptions["video"]>(
    key: K,
    value: RecordingOptions["video"][K],
  ) => void;
  setAudioOption: <K extends keyof RecordingOptions["audio"]>(
    key: K,
    value: RecordingOptions["audio"][K],
  ) => void;
  setWebcamOption: <K extends keyof RecordingOptions["webcam"]>(
    key: K,
    value: RecordingOptions["webcam"][K],
  ) => void;

  requestPermissions: () => Promise<boolean>;
  startRecording: () => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => Promise<RecordingResult | null>;
  cancelRecording: () => void;
  reset: () => void;

  openModal: () => void;
  closeModal: () => void;
  minimizeControls: () => void;
  expandControls: () => void;
}

export const useRecorderStore = create<RecorderState>((set, get) => {
  screenRecorderService.on("duration", (duration) => {
    set({ duration: duration as number });
  });

  screenRecorderService.on("stop", () => {
    set({ status: "processing" });
  });

  screenRecorderService.on("error", (error) => {
    const errorMessage =
      error instanceof Error ? error.message : "Recording error occurred";
    set({ status: "error", error: errorMessage });
  });

  return {
    status: "idle",
    duration: 0,
    error: null,
    options: DEFAULT_RECORDING_OPTIONS,
    screenStream: null,
    webcamStream: null,
    result: null,
    isModalOpen: false,
    isControlsMinimized: false,

    setOptions: (newOptions) => {
      set((state) => ({
        options: {
          ...state.options,
          ...newOptions,
          video: { ...state.options.video, ...newOptions.video },
          audio: { ...state.options.audio, ...newOptions.audio },
          webcam: { ...state.options.webcam, ...newOptions.webcam },
        },
      }));
    },

    setVideoOption: (key, value) => {
      set((state) => ({
        options: {
          ...state.options,
          video: { ...state.options.video, [key]: value },
        },
      }));
    },

    setAudioOption: (key, value) => {
      set((state) => ({
        options: {
          ...state.options,
          audio: { ...state.options.audio, [key]: value },
        },
      }));
    },

    setWebcamOption: (key, value) => {
      set((state) => ({
        options: {
          ...state.options,
          webcam: { ...state.options.webcam, [key]: value },
        },
      }));
    },

    requestPermissions: async () => {
      const { options } = get();
      set({ status: "requesting", error: null });

      try {
        const streams = await screenRecorderService.requestPermissions(options);
        set({
          screenStream: streams.screenStream,
          webcamStream: streams.webcamStream || null,
          status: "idle",
        });
        return true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Permission denied";
        set({ status: "error", error: message });
        return false;
      }
    },

    startRecording: async () => {
      const { options, screenStream } = get();

      if (!screenStream) {
        set({ status: "error", error: "No screen stream available" });
        return;
      }

      set({ status: "countdown" });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      try {
        await screenRecorderService.startRecording(options);
        set({ status: "recording", duration: 0 });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to start recording";
        set({ status: "error", error: message });
      }
    },

    pauseRecording: () => {
      screenRecorderService.pauseRecording();
      set({ status: "paused" });
    },

    resumeRecording: () => {
      screenRecorderService.resumeRecording();
      set({ status: "recording" });
    },

    stopRecording: async () => {
      set({ status: "processing" });

      try {
        const result = await screenRecorderService.stopRecording();
        set({ result, status: "idle" });
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to stop recording";
        set({ status: "error", error: message });
        return null;
      }
    },

    cancelRecording: () => {
      screenRecorderService.cancelRecording();
      set({
        status: "idle",
        duration: 0,
        screenStream: null,
        webcamStream: null,
        result: null,
      });
    },

    reset: () => {
      screenRecorderService.cancelRecording();
      set({
        status: "idle",
        duration: 0,
        error: null,
        screenStream: null,
        webcamStream: null,
        result: null,
        isModalOpen: false,
        isControlsMinimized: false,
      });
    },

    openModal: () => {
      set({ isModalOpen: true });
    },

    closeModal: () => {
      const { status } = get();
      if (status === "idle" || status === "error") {
        set({ isModalOpen: false, error: null });
      }
    },

    minimizeControls: () => {
      set({ isControlsMinimized: true });
    },

    expandControls: () => {
      set({ isControlsMinimized: false });
    },
  };
});
