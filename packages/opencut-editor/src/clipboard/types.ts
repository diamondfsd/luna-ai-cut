import type { EditorCore } from "@/core";
import type {
	AnimationInterpolation,
	AnimationPath,
	ScalarCurveKeyframePatch,
	SelectedKeyframeRef,
} from "@/animation/types";
import type { ParamValue } from "@/params";
import type { Command } from "@/commands/base-command";
import type {
	CreateTimelineElement,
	ElementRef,
	TrackType,
} from "@/timeline";
import type { MediaTime } from "@/wasm";

export interface ElementClipboardItem {
	trackId: string;
	trackType: TrackType;
	element: CreateTimelineElement;
}

export interface KeyframeClipboardCurvePatch {
	componentKey: string;
	patch: ScalarCurveKeyframePatch;
}

export interface KeyframeClipboardItem {
	propertyPath: AnimationPath;
	timeOffset: MediaTime;
	value: ParamValue;
	interpolation: AnimationInterpolation;
	curvePatches: KeyframeClipboardCurvePatch[];
}

export interface ElementsClipboardEntry {
	type: "elements";
	items: ElementClipboardItem[];
}

export interface KeyframesClipboardEntry {
	type: "keyframes";
	sourceElement: ElementRef;
	items: KeyframeClipboardItem[];
}

export interface ClipboardEntryByType {
	elements: ElementsClipboardEntry;
	keyframes: KeyframesClipboardEntry;
}

export type ClipboardEntry = ClipboardEntryByType[keyof ClipboardEntryByType];
export type ClipboardEntryType = keyof ClipboardEntryByType;

export interface CopyContext {
	editor: EditorCore;
	selectedElements: ElementRef[];
	selectedKeyframes: SelectedKeyframeRef[];
}

export interface PasteContext {
	editor: EditorCore;
	selectedElements: ElementRef[];
	selectedKeyframes: SelectedKeyframeRef[];
	time: MediaTime;
}

export interface ClipboardHandler<TType extends ClipboardEntryType> {
	type: TType;
	canCopy(context: CopyContext): boolean;
	copy(context: CopyContext): ClipboardEntryByType[TType] | null;
	paste(args: {
		entry: ClipboardEntryByType[TType];
		context: PasteContext;
	}): Command | null;
}

export type ClipboardHandlerMap = {
	[TType in ClipboardEntryType]: ClipboardHandler<TType>;
};
