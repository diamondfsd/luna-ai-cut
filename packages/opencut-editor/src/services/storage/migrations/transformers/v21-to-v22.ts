import { converter, parse } from "culori";
import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

const COLOR_COMPONENT_KEYS = ["r", "g", "b", "a"] as const;
type LegacyInterpolation = "linear" | "hold";

const toRgb = converter("rgb");

interface LinearRgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

function srgbToLinear({ value }: { value: number }): number {
	return value <= 0.04045
		? value / 12.92
		: Math.pow((value + 0.055) / 1.055, 2.4);
}

function parseColorToLinearRgba({
	color,
}: {
	color: string;
}): LinearRgba | null {
	const parsed = parse(color);
	const rgb = parsed ? toRgb(parsed) : null;
	if (!rgb) {
		return null;
	}

	return {
		r: srgbToLinear({ value: rgb.r ?? 0 }),
		g: srgbToLinear({ value: rgb.g ?? 0 }),
		b: srgbToLinear({ value: rgb.b ?? 0 }),
		a: Math.max(0, Math.min(1, rgb.alpha ?? 1)),
	};
}

interface LegacyScalarKeyframe {
	id: string;
	time: number;
	value: number;
	interpolation: LegacyInterpolation;
}

interface LegacyDiscreteKeyframe {
	id: string;
	time: number;
	value: string | boolean;
}

interface LegacyVectorValue {
	x: number;
	y: number;
}

interface LegacyVectorKeyframe {
	id: string;
	time: number;
	value: LegacyVectorValue;
	interpolation: LegacyInterpolation;
}

interface MigratedAnimationChannel {
	binding: ProjectRecord;
	channels: Record<string, ProjectRecord>;
}

export function transformProjectV21ToV22({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project })) {
		return { project, skipped: true, reason: "no project id" };
	}

	const version = project.version;
	if (typeof version !== "number") {
		return { project, skipped: true, reason: "invalid version" };
	}
	if (version >= 22) {
		return { project, skipped: true, reason: "already v22" };
	}
	if (version !== 21) {
		return { project, skipped: true, reason: "not v21" };
	}

	return {
		project: {
			...migrateProjectAnimations({ project }),
			version: 22,
		},
		skipped: false,
	};
}

function migrateProjectAnimations({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	const scenes = project.scenes;
	if (!Array.isArray(scenes)) {
		return project;
	}

	return {
		...project,
		scenes: scenes.map((scene) => migrateSceneAnimations({ scene })),
	};
}

function migrateSceneAnimations({ scene }: { scene: unknown }): unknown {
	if (!isRecord(scene)) {
		return scene;
	}

	const tracks = scene.tracks;
	if (!Array.isArray(tracks)) {
		return scene;
	}

	return {
		...scene,
		tracks: tracks.map((track) => migrateTrackAnimations({ track })),
	};
}

function migrateTrackAnimations({ track }: { track: unknown }): unknown {
	if (!isRecord(track)) {
		return track;
	}

	const elements = track.elements;
	if (!Array.isArray(elements)) {
		return track;
	}

	return {
		...track,
		elements: elements.map((element) => migrateElementAnimations({ element })),
	};
}

function migrateElementAnimations({ element }: { element: unknown }): unknown {
	if (!isRecord(element)) {
		return element;
	}

	const animations = element.animations;
	if (!isRecord(animations)) {
		return element;
	}

	if (isRecord(animations.bindings)) {
		return element;
	}

	const migratedAnimations = migrateLegacyAnimations({ animations });
	if (!migratedAnimations) {
		const { animations: _unusedAnimations, ...elementWithoutAnimations } = element;
		return elementWithoutAnimations;
	}

	return {
		...element,
		animations: migratedAnimations,
	};
}

function migrateLegacyAnimations({
	animations,
}: {
	animations: ProjectRecord;
}): ProjectRecord | null {
	const legacyChannels = animations.channels;
	if (!isRecord(legacyChannels)) {
		return null;
	}

	const nextBindings: Record<string, ProjectRecord> = {};
	const nextChannels: Record<string, ProjectRecord> = {};

	for (const [propertyPath, channel] of Object.entries(legacyChannels)) {
		const migratedChannel = migrateLegacyChannel({
			propertyPath,
			channel,
		});
		if (!migratedChannel) {
			continue;
		}

		nextBindings[propertyPath] = migratedChannel.binding;
		Object.assign(nextChannels, migratedChannel.channels);
	}

	if (Object.keys(nextBindings).length === 0) {
		return null;
	}

	return {
		bindings: nextBindings,
		channels: nextChannels,
	};
}

function migrateLegacyChannel({
	propertyPath,
	channel,
}: {
	propertyPath: string;
	channel: unknown;
}): MigratedAnimationChannel | null {
	if (!isRecord(channel)) {
		return null;
	}

	switch (channel.valueKind) {
		case "number":
			return migrateNumberChannel({ propertyPath, channel });
		case "discrete":
			return migrateDiscreteChannel({ propertyPath, channel });
		case "vector":
			return migrateVectorChannel({ propertyPath, channel });
		case "color":
			return migrateColorChannel({ propertyPath, channel });
		default:
			return null;
	}
}

function migrateNumberChannel({
	propertyPath,
	channel,
}: {
	propertyPath: string;
	channel: ProjectRecord;
}): MigratedAnimationChannel | null {
	const legacyKeys = getLegacyScalarKeyframes({
		channel,
		isValidValue: (value): value is number =>
			typeof value === "number" && Number.isFinite(value),
	});
	if (legacyKeys.length === 0) {
		return null;
	}

	return {
		binding: {
			path: propertyPath,
			kind: "number",
			components: [
				{
					key: "value",
					channelId: buildChannelId({
						propertyPath,
						componentKey: "value",
					}),
				},
			],
		},
		channels: {
			[buildChannelId({ propertyPath, componentKey: "value" })]: {
				kind: "scalar",
				keys: legacyKeys.map((keyframe) => toScalarKeyframe({ keyframe })),
			},
		},
	};
}

function migrateDiscreteChannel({
	propertyPath,
	channel,
}: {
	propertyPath: string;
	channel: ProjectRecord;
}): MigratedAnimationChannel | null {
	const legacyKeys = getLegacyDiscreteKeyframes({ channel });
	if (legacyKeys.length === 0) {
		return null;
	}

	return {
		binding: {
			path: propertyPath,
			kind: "discrete",
			components: [
				{
					key: "value",
					channelId: buildChannelId({
						propertyPath,
						componentKey: "value",
					}),
				},
			],
		},
		channels: {
			[buildChannelId({ propertyPath, componentKey: "value" })]: {
				kind: "discrete",
				keys: legacyKeys.map((keyframe) => ({
					id: keyframe.id,
					time: keyframe.time,
					value: keyframe.value,
				})),
			},
		},
	};
}

function migrateVectorChannel({
	propertyPath,
	channel,
}: {
	propertyPath: string;
	channel: ProjectRecord;
}): MigratedAnimationChannel | null {
	const legacyKeys = getLegacyScalarKeyframes({
		channel,
		isValidValue: isLegacyVectorValue,
	});
	if (legacyKeys.length === 0) {
		return null;
	}

	const xChannelId = buildChannelId({ propertyPath, componentKey: "x" });
	const yChannelId = buildChannelId({ propertyPath, componentKey: "y" });

	return {
		binding: {
			path: propertyPath,
			kind: "vector2",
			components: [
				{ key: "x", channelId: xChannelId },
				{ key: "y", channelId: yChannelId },
			],
		},
		channels: {
			[xChannelId]: {
				kind: "scalar",
				keys: legacyKeys.map((keyframe) =>
					toScalarKeyframe({
						keyframe: {
							...keyframe,
							value: keyframe.value.x,
						},
					}),
				),
			},
			[yChannelId]: {
				kind: "scalar",
				keys: legacyKeys.map((keyframe) =>
					toScalarKeyframe({
						keyframe: {
							...keyframe,
							value: keyframe.value.y,
						},
					}),
				),
			},
		},
	};
}

function migrateColorChannel({
	propertyPath,
	channel,
}: {
	propertyPath: string;
	channel: ProjectRecord;
}): MigratedAnimationChannel | null {
	const legacyKeys = getLegacyScalarKeyframes({
		channel,
		isValidValue: (value): value is string => typeof value === "string",
	});
	if (legacyKeys.length === 0) {
		return null;
	}

	const colorKeys = legacyKeys.flatMap((keyframe) => {
		const linearRgba = parseColorToLinearRgba({ color: keyframe.value });
		if (!linearRgba) {
			return [];
		}

		return [
			{
				id: keyframe.id,
				time: keyframe.time,
				interpolation: keyframe.interpolation,
				values: linearRgba,
			},
		];
	});
	if (colorKeys.length === 0) {
		return null;
	}

	const channels = Object.fromEntries(
		COLOR_COMPONENT_KEYS.map((componentKey) => [
			buildChannelId({ propertyPath, componentKey }),
			{
				kind: "scalar",
				keys: colorKeys.map((keyframe) =>
					toScalarKeyframe({
						keyframe: {
							id: keyframe.id,
							time: keyframe.time,
							value: keyframe.values[componentKey],
							interpolation: keyframe.interpolation,
						},
					}),
				),
			},
		]),
	);

	return {
		binding: {
			path: propertyPath,
			kind: "color",
			colorSpace: "srgb-linear",
			components: COLOR_COMPONENT_KEYS.map((componentKey) => ({
				key: componentKey,
				channelId: buildChannelId({ propertyPath, componentKey }),
			})),
		},
		channels,
	};
}

function getLegacyScalarKeyframes<TValue>({
	channel,
	isValidValue,
}: {
	channel: ProjectRecord;
	isValidValue: (value: unknown) => value is TValue;
}): Array<{
	id: string;
	time: number;
	value: TValue;
	interpolation: LegacyInterpolation;
}> {
	const keyframes = channel.keyframes;
	if (!Array.isArray(keyframes)) {
		return [];
	}

	return keyframes.flatMap((keyframe) => {
		if (!isRecord(keyframe)) {
			return [];
		}

		if (
			typeof keyframe.id !== "string" ||
			typeof keyframe.time !== "number" ||
			!Number.isFinite(keyframe.time) ||
			!isValidValue(keyframe.value)
		) {
			return [];
		}

		return [
			{
				id: keyframe.id,
				time: keyframe.time,
				value: keyframe.value,
				interpolation:
					keyframe.interpolation === "hold" ? "hold" : "linear",
			},
		];
	});
}

function getLegacyDiscreteKeyframes({
	channel,
}: {
	channel: ProjectRecord;
}): LegacyDiscreteKeyframe[] {
	const keyframes = channel.keyframes;
	if (!Array.isArray(keyframes)) {
		return [];
	}

	return keyframes.flatMap((keyframe) => {
		if (!isRecord(keyframe)) {
			return [];
		}

		if (
			typeof keyframe.id !== "string" ||
			typeof keyframe.time !== "number" ||
			!Number.isFinite(keyframe.time) ||
			(typeof keyframe.value !== "string" && typeof keyframe.value !== "boolean")
		) {
			return [];
		}

		return [
			{
				id: keyframe.id,
				time: keyframe.time,
				value: keyframe.value,
			},
		];
	});
}

function isLegacyVectorValue(value: unknown): value is LegacyVectorValue {
	return (
		isRecord(value) &&
		typeof value.x === "number" &&
		Number.isFinite(value.x) &&
		typeof value.y === "number" &&
		Number.isFinite(value.y)
	);
}

function toScalarKeyframe({
	keyframe,
}: {
	keyframe: LegacyScalarKeyframe;
}): ProjectRecord {
	return {
		id: keyframe.id,
		time: keyframe.time,
		value: keyframe.value,
		segmentToNext:
			keyframe.interpolation === "hold" ? "step" : "linear",
		tangentMode: "flat",
	};
}

function buildChannelId({
	propertyPath,
	componentKey,
}: {
	propertyPath: string;
	componentKey: string;
}) {
	return `${propertyPath}:${componentKey}`;
}
