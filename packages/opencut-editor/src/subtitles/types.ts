import type { TextBackground } from "@/text/background";
import type {
	TextAlign,
	TextDecoration,
	TextFontStyle,
	TextFontWeight,
} from "@/text/primitives";
import type { CaptionChunk } from "@/transcription/types";

export interface SubtitlePlacementStyle {
	verticalAlign?: "top" | "middle" | "bottom";
	marginLeftRatio?: number;
	marginRightRatio?: number;
	marginVerticalRatio?: number;
}

export interface SubtitleStyleOverrides {
	/**
	 * Font size in app units (same coordinate space as TextElement.fontSize).
	 * Use fontSizeRatioOfPlayHeight when the source coordinate space is unknown
	 * (e.g. ASS files, where font size is relative to the script's play resolution).
	 */
	fontSize?: number;
	/**
	 * Font size expressed as a fraction of the reference canvas height.
	 * Set by the ASS parser so the builder can convert to app units without
	 * the parser needing to know about the app's coordinate system.
	 * Takes precedence over fontSize when both are present.
	 */
	fontSizeRatioOfPlayHeight?: number;
	fontFamily?: string;
	color?: string;
	background?: Pick<TextBackground, "enabled" | "color"> &
		Partial<Omit<TextBackground, "enabled" | "color">>;
	textAlign?: TextAlign;
	fontWeight?: TextFontWeight;
	fontStyle?: TextFontStyle;
	textDecoration?: TextDecoration;
	letterSpacing?: number;
	lineHeight?: number;
	placement?: SubtitlePlacementStyle;
}

export interface SubtitleCue extends CaptionChunk {
	style?: SubtitleStyleOverrides;
}

export interface ParseSubtitleResult {
	captions: SubtitleCue[];
	skippedCueCount: number;
	warnings: string[];
}
