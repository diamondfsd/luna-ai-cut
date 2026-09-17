export interface SnapPoint {
  time: number;
  type: "clip-start" | "clip-end" | "playhead" | "marker" | "grid";
}

export interface SnapResult {
  time: number;
  snapped: boolean;
  snapPoint?: SnapPoint;
}

export interface SnapSettings {
  enabled: boolean;
  snapToClips: boolean;
  snapToPlayhead: boolean;
  snapToGrid: boolean;
  gridSize: number;
  snapThreshold: number;
}

export interface ClipStyle {
  bg: string;
  border: string;
  text: string;
  selectedText: string;
}

export interface TrackInfo {
  label: string;
  icon: React.ElementType;
  color: string;
  textColor: string;
  bgLight: string;
}
