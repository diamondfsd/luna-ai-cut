import type {
	ParseSubtitleResult,
	SubtitleCue,
	SubtitleStyleOverrides,
} from "./types";

const ASS_DEFAULT_PLAY_RES_X = 384;
const ASS_DEFAULT_PLAY_RES_Y = 288;
const STYLE_SECTION_NAMES = new Set(["v4 styles", "v4+ styles"]);
const ALIGNMENT_MAP: Record<
	number,
	{
		textAlign: NonNullable<SubtitleStyleOverrides["textAlign"]>;
		verticalAlign: NonNullable<
			NonNullable<SubtitleStyleOverrides["placement"]>["verticalAlign"]
		>;
	}
> = {
	1: { textAlign: "left", verticalAlign: "bottom" },
	2: { textAlign: "center", verticalAlign: "bottom" },
	3: { textAlign: "right", verticalAlign: "bottom" },
	4: { textAlign: "left", verticalAlign: "middle" },
	5: { textAlign: "center", verticalAlign: "middle" },
	6: { textAlign: "right", verticalAlign: "middle" },
	7: { textAlign: "left", verticalAlign: "top" },
	8: { textAlign: "center", verticalAlign: "top" },
	9: { textAlign: "right", verticalAlign: "top" },
};

interface AssScriptInfo {
	playResX: number;
	playResY: number;
}

interface AssStyleRecord {
	name: string;
	fontname?: string;
	fontsize?: string;
	primarycolour?: string;
	secondarycolour?: string;
	outlinecolour?: string;
	backcolour?: string;
	bold?: string;
	italic?: string;
	underline?: string;
	strikeout?: string;
	scalex?: string;
	scaley?: string;
	spacing?: string;
	angle?: string;
	borderstyle?: string;
	outline?: string;
	shadow?: string;
	alignment?: string;
	marginl?: string;
	marginr?: string;
	marginv?: string;
}

export function parseAss({ input }: { input: string }): ParseSubtitleResult {
	const normalized = input.replace(/\r\n?/g, "\n").trim();
	if (!normalized) {
		return {
			captions: [],
			skippedCueCount: 0,
			warnings: [],
		};
	}

	const scriptInfo: AssScriptInfo = {
		playResX: ASS_DEFAULT_PLAY_RES_X,
		playResY: ASS_DEFAULT_PLAY_RES_Y,
	};
	const warnings = new Set<string>();
	const styles = new Map<string, SubtitleStyleOverrides>();
	const captions: SubtitleCue[] = [];

	let currentSection = "";
	let styleFormat: string[] | null = null;
	let eventFormat: string[] | null = null;
	let skippedCueCount = 0;
	let strippedInlineTagCueCount = 0;
	let skippedNonDialogueEventCount = 0;
	let ignoredEffectCount = 0;
	let missingStyleCueCount = 0;
	let usesHeavilyUnsupportedStyles = false;

	for (const rawLine of normalized.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith(";")) {
			continue;
		}

		const sectionMatch = line.match(/^\[(.+)\]$/);
		if (sectionMatch) {
			currentSection = sectionMatch[1].trim().toLowerCase();
			continue;
		}

		if (currentSection === "script info") {
			const [rawKey, ...rest] = line.split(":");
			if (!rawKey || rest.length === 0) continue;

			const key = rawKey.trim().toLowerCase();
			const value = rest.join(":").trim();
			const parsedValue = parseFloat(value);

			if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
				continue;
			}

			if (key === "playresx") {
				scriptInfo.playResX = parsedValue;
			}
			if (key === "playresy") {
				scriptInfo.playResY = parsedValue;
			}
			continue;
		}

		if (STYLE_SECTION_NAMES.has(currentSection)) {
			if (line.startsWith("Format:")) {
				styleFormat = parseAssFormat({ line });
				continue;
			}

			if (line.startsWith("Style:") && styleFormat) {
				const values = splitAssFields({
					value: line.slice("Style:".length).trim(),
					expectedFieldCount: styleFormat.length,
				});
				if (values.length !== styleFormat.length) {
					continue;
				}

				const record = mapFieldsToRecord<AssStyleRecord>({
					fields: styleFormat,
					values,
				});
				if (!record.name) {
					continue;
				}

				const mappedStyle = mapAssStyleToSubtitleStyle({
					style: record,
					scriptInfo,
				});
				usesHeavilyUnsupportedStyles ||= mappedStyle.hasUnsupportedFeatures;
				styles.set(record.name.toLowerCase(), mappedStyle.style);
			}
			continue;
		}

		if (currentSection !== "events") {
			continue;
		}

		if (line.startsWith("Format:")) {
			eventFormat = parseAssFormat({ line });
			continue;
		}

		if (!eventFormat) {
			continue;
		}

		if (line.startsWith("Dialogue:")) {
			const values = splitAssFields({
				value: line.slice("Dialogue:".length).trim(),
				expectedFieldCount: eventFormat.length,
			});
			if (values.length !== eventFormat.length) {
				skippedCueCount += 1;
				continue;
			}

			const record = mapFieldsToRecord<Record<string, string>>({
				fields: eventFormat,
				values,
			});
			const startTime = parseAssTimestamp({ input: record.start });
			const endTime = parseAssTimestamp({ input: record.end });
			const duration = endTime - startTime;
			if (
				!Number.isFinite(startTime) ||
				!Number.isFinite(endTime) ||
				duration <= 0
			) {
				skippedCueCount += 1;
				continue;
			}

			const strippedText = stripAssText({
				input: record.text ?? "",
			});
			strippedInlineTagCueCount += strippedText.hadInlineTags ? 1 : 0;
			if (!strippedText.text) {
				skippedCueCount += 1;
				continue;
			}

			if (record.effect?.trim()) {
				ignoredEffectCount += 1;
			}

			const referencedStyleName = record.style?.trim().toLowerCase();
			const referencedStyle = referencedStyleName
				? styles.get(referencedStyleName)
				: undefined;
			if (referencedStyleName && !referencedStyle) {
				missingStyleCueCount += 1;
			}
			const style = referencedStyle ?? styles.get("default");

			captions.push({
				text: strippedText.text,
				startTime,
				duration,
				style,
			});
			continue;
		}

		if (line.includes(":")) {
			skippedNonDialogueEventCount += 1;
		}
	}

	if (strippedInlineTagCueCount > 0) {
		warnings.add(
			`Stripped unsupported ASS inline override tags from ${strippedInlineTagCueCount} subtitle cue(s).`,
		);
	}

	if (ignoredEffectCount > 0) {
		warnings.add(
			`Ignored ASS event effects in ${ignoredEffectCount} subtitle cue(s).`,
		);
	}

	if (missingStyleCueCount > 0) {
		warnings.add(
			`Fell back to default subtitle styling for ${missingStyleCueCount} cue(s) that referenced missing ASS styles.`,
		);
	}

	if (skippedNonDialogueEventCount > 0) {
		warnings.add(
			`Ignored ${skippedNonDialogueEventCount} non-dialogue ASS event(s).`,
		);
	}

	if (usesHeavilyUnsupportedStyles) {
		warnings.add(
			"Ignored unsupported ASS style features such as outline, shadow, rotation, or scaling.",
		);
	}

	return {
		captions,
		skippedCueCount,
		warnings: [...warnings],
	};
}

function parseAssFormat({ line }: { line: string }): string[] {
	return line
		.slice(line.indexOf(":") + 1)
		.split(",")
		.map((field) => field.trim().toLowerCase());
}

function splitAssFields({
	value,
	expectedFieldCount,
}: {
	value: string;
	expectedFieldCount: number;
}): string[] {
	if (expectedFieldCount <= 1) {
		return [value];
	}

	const result: string[] = [];
	let current = "";

	for (const character of value) {
		if (character === "," && result.length < expectedFieldCount - 1) {
			result.push(current.trim());
			current = "";
			continue;
		}

		current += character;
	}

	result.push(current.trim());
	return result;
}

function mapFieldsToRecord<T extends object>({
	fields,
	values,
}: {
	fields: string[];
	values: string[];
}): T {
	const record = {} as Record<string, string | undefined>;

	for (let index = 0; index < fields.length; index++) {
		record[fields[index]] = values[index];
	}

	return record as T;
}

function parseAssTimestamp({ input }: { input: string | undefined }): number {
	if (!input) {
		return Number.NaN;
	}

	const match = input.trim().match(/^(\d+):(\d{2}):(\d{2})[.](\d{1,2}|\d{3})$/);
	if (!match) {
		return Number.NaN;
	}

	const [, hours, minutes, seconds, fraction] = match;
	const parsedHours = Number.parseInt(hours, 10);
	const parsedMinutes = Number.parseInt(minutes, 10);
	const parsedSeconds = Number.parseInt(seconds, 10);
	const parsedMilliseconds = Number.parseInt(fraction.padEnd(3, "0"), 10);

	return (
		parsedHours * 3600 +
		parsedMinutes * 60 +
		parsedSeconds +
		parsedMilliseconds / 1000
	);
}

function stripAssText({ input }: { input: string }): {
	text: string;
	hadInlineTags: boolean;
} {
	const hadInlineTags = /\{[^}]*\}/.test(input);
	const text = input
		.replace(/\{[^}]*\}/g, "")
		.replace(/\\N/gi, "\n")
		.replace(/\\h/g, " ")
		.replace(/\\n/g, "\n")
		.trim();

	return {
		text,
		hadInlineTags,
	};
}

function mapAssStyleToSubtitleStyle({
	style,
	scriptInfo,
}: {
	style: AssStyleRecord;
	scriptInfo: AssScriptInfo;
}): {
	style: SubtitleStyleOverrides;
	hasUnsupportedFeatures: boolean;
} {
	const fontSize = parseFloat(style.fontsize ?? "");
	const primaryColor = parseAssColor({ input: style.primarycolour });
	const backColor = parseAssColor({ input: style.backcolour });
	const bold = parseAssBoolean({ input: style.bold });
	const italic = parseAssBoolean({ input: style.italic });
	const underline = parseAssBoolean({ input: style.underline });
	const strikeOut = parseAssBoolean({ input: style.strikeout });
	const borderStyle = parseFloat(style.borderstyle ?? "");
	const spacing = parseFloat(style.spacing ?? "");
	const alignment = parseFloat(style.alignment ?? "");
	const marginLeft = parseFloat(style.marginl ?? "");
	const marginRight = parseFloat(style.marginr ?? "");
	const marginVertical = parseFloat(style.marginv ?? "");
	// Store as a ratio of playResY so the builder can convert to app units
	// without the parser needing to know the app's coordinate system.
	const fontSizeRatioOfPlayHeight = Number.isFinite(fontSize)
		? Math.round((fontSize / scriptInfo.playResY) * 1000) / 1000
		: null;

	const mappedAlignment =
		ALIGNMENT_MAP[Math.round(alignment)] ?? ALIGNMENT_MAP[2];
	const placement =
		Number.isFinite(marginLeft) ||
		Number.isFinite(marginRight) ||
		Number.isFinite(marginVertical) ||
		mappedAlignment.verticalAlign !== "bottom"
			? {
					verticalAlign: mappedAlignment.verticalAlign,
					marginLeftRatio: Number.isFinite(marginLeft)
						? marginLeft / scriptInfo.playResX
						: undefined,
					marginRightRatio: Number.isFinite(marginRight)
						? marginRight / scriptInfo.playResX
						: undefined,
					marginVerticalRatio: Number.isFinite(marginVertical)
						? marginVertical / scriptInfo.playResY
						: undefined,
				}
			: undefined;

	const styleOverrides: SubtitleStyleOverrides = {
		...(style.fontname ? { fontFamily: style.fontname.trim() } : {}),
		...(fontSizeRatioOfPlayHeight !== null && fontSizeRatioOfPlayHeight > 0
			? { fontSizeRatioOfPlayHeight }
			: {}),
		...(primaryColor?.cssColor ? { color: primaryColor.cssColor } : {}),
		...(bold !== null ? { fontWeight: bold ? "bold" : "normal" } : {}),
		...(italic !== null ? { fontStyle: italic ? "italic" : "normal" } : {}),
		...(underline || strikeOut
			? {
					textDecoration: underline
						? "underline"
						: strikeOut
							? "line-through"
							: "none",
				}
			: {}),
		...(Number.isFinite(spacing) ? { letterSpacing: spacing } : {}),
		textAlign: mappedAlignment.textAlign,
		...(placement ? { placement } : {}),
		...(backColor?.cssColor && Math.round(borderStyle) === 3
			? {
					background: {
						enabled: backColor.alpha > 0,
						color: backColor.alpha > 0 ? backColor.cssColor : "transparent",
					},
				}
			: {}),
	};

	const hasUnsupportedFeatures =
		Math.round(borderStyle) !== 1 && Math.round(borderStyle) !== 3
			? true
			: (parseFloat(style.outline ?? "") || 0) > 0 ||
				(parseFloat(style.shadow ?? "") || 0) > 0 ||
				(parseFloat(style.angle ?? "") || 0) !== 0 ||
				(Number.isFinite(parseFloat(style.scalex ?? "")) &&
					parseFloat(style.scalex ?? "") !== 100) ||
				(Number.isFinite(parseFloat(style.scaley ?? "")) &&
					parseFloat(style.scaley ?? "") !== 100) ||
				Boolean(underline && strikeOut);

	return {
		style: styleOverrides,
		hasUnsupportedFeatures,
	};
}

function parseAssBoolean({
	input,
}: {
	input: string | undefined;
}): boolean | null {
	if (input === undefined) {
		return null;
	}

	const trimmed = input.trim();
	if (!trimmed) {
		return null;
	}

	const parsed = Number.parseInt(trimmed, 10);
	if (!Number.isFinite(parsed)) {
		return null;
	}

	return parsed !== 0;
}

function parseAssColor({
	input,
}: {
	input: string | undefined;
}): { cssColor: string; alpha: number } | null {
	if (!input) {
		return null;
	}

	const normalized = input.trim().replace(/^&?H/i, "").padStart(8, "0");
	if (!/^[0-9a-fA-F]{8}$/.test(normalized)) {
		return null;
	}

	const alphaHex = normalized.slice(0, 2);
	const blueHex = normalized.slice(2, 4);
	const greenHex = normalized.slice(4, 6);
	const redHex = normalized.slice(6, 8);

	const red = Number.parseInt(redHex, 16);
	const green = Number.parseInt(greenHex, 16);
	const blue = Number.parseInt(blueHex, 16);
	const alpha = 1 - Number.parseInt(alphaHex, 16) / 255;

	if (alpha >= 1) {
		return {
			cssColor: `#${redHex}${greenHex}${blueHex}`.toLowerCase(),
			alpha,
		};
	}

	return {
		cssColor: `rgba(${red}, ${green}, ${blue}, ${Math.round(alpha * 1000) / 1000})`,
		alpha,
	};
}
