import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV11ToV12({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project })) {
		return { project, skipped: true, reason: "no project id" };
	}

	if (typeof project.version === "number" && project.version >= 12) {
		return { project, skipped: true, reason: "already v12" };
	}

	const migratedProject = migrateProjectPosition({ project });

	return {
		project: { ...migratedProject, version: 12 },
		skipped: false,
	};
}

function migrateProjectPosition({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	const scenesValue = project.scenes;
	if (!Array.isArray(scenesValue)) return project;

	const migratedScenes = scenesValue.map((scene) =>
		migrateScenePosition({ scene }),
	);

	return { ...project, scenes: migratedScenes };
}

function migrateScenePosition({ scene }: { scene: unknown }): unknown {
	if (!isRecord(scene)) return scene;

	const tracksValue = scene.tracks;
	if (!Array.isArray(tracksValue)) return scene;

	const migratedTracks = tracksValue.map((track) =>
		migrateTrackPosition({ track }),
	);

	return { ...scene, tracks: migratedTracks };
}

function migrateTrackPosition({ track }: { track: unknown }): unknown {
	if (!isRecord(track)) return track;

	const elementsValue = track.elements;
	if (!Array.isArray(elementsValue)) return track;

	const migratedElements = elementsValue.map((element) =>
		migrateElementPosition({ element }),
	);

	return { ...track, elements: migratedElements };
}

function migrateElementPosition({ element }: { element: unknown }): unknown {
	if (!isRecord(element)) return element;

	const animations = element.animations;
	if (!isRecord(animations) || !isRecord(animations.channels)) return element;

	const channels = animations.channels as Record<string, unknown>;
	const xChannel = channels["transform.position.x"];
	const yChannel = channels["transform.position.y"];

	if (!xChannel && !yChannel) return element;

	const baseTransform = isRecord(element.transform) ? element.transform : {};
	const basePosition = isRecord(baseTransform.position)
		? baseTransform.position
		: {};
	const baseX = typeof basePosition.x === "number" ? basePosition.x : 0;
	const baseY = typeof basePosition.y === "number" ? basePosition.y : 0;

	const xKeyframes = getKeyframes({ channel: xChannel });
	const yKeyframes = getKeyframes({ channel: yChannel });

	const allTimes = Array.from(
		new Set([
			...xKeyframes.map((kf) => kf.time),
			...yKeyframes.map((kf) => kf.time),
		]),
	).sort((a, b) => a - b);

	const vectorKeyframes = allTimes.map((time) => {
		const xKf = xKeyframes.find((kf) => Math.abs(kf.time - time) < 0.001);
		const yKf = yKeyframes.find((kf) => Math.abs(kf.time - time) < 0.001);
		const x =
			typeof xKf?.value === "number"
				? xKf.value
				: interpolateScalarAtTime({
						keyframes: xKeyframes,
						time,
						fallback: baseX,
					});
		const y =
			typeof yKf?.value === "number"
				? yKf.value
				: interpolateScalarAtTime({
						keyframes: yKeyframes,
						time,
						fallback: baseY,
					});
		const interpolation = xKf?.interpolation ?? yKf?.interpolation ?? "linear";
		return {
			id: xKf?.id ?? yKf?.id ?? crypto.randomUUID(),
			time,
			value: { x, y },
			interpolation,
		};
	});

	const newChannels = { ...channels };
	delete newChannels["transform.position.x"];
	delete newChannels["transform.position.y"];
	newChannels["transform.position"] = {
		valueKind: "vector",
		keyframes: vectorKeyframes,
	};

	return {
		...element,
		animations: { ...animations, channels: newChannels },
	};
}

interface ScalarKeyframe {
	id: string;
	time: number;
	value: number;
	interpolation: string;
}

function getKeyframes({ channel }: { channel: unknown }): ScalarKeyframe[] {
	if (!isRecord(channel)) return [];
	if (!Array.isArray(channel.keyframes)) return [];
	return channel.keyframes.flatMap((kf) => {
		if (!isRecord(kf)) return [];
		if (
			typeof kf.id !== "string" ||
			typeof kf.time !== "number" ||
			typeof kf.value !== "number"
		)
			return [];
		return [
			{
				id: kf.id,
				time: kf.time,
				value: kf.value,
				interpolation:
					typeof kf.interpolation === "string" ? kf.interpolation : "linear",
			},
		];
	});
}

function interpolateScalarAtTime({
	keyframes,
	time,
	fallback,
}: {
	keyframes: ScalarKeyframe[];
	time: number;
	fallback: number;
}): number {
	if (keyframes.length === 0) return fallback;

	const sorted = [...keyframes].sort((a, b) => a.time - b.time);
	const first = sorted[0];
	const last = sorted[sorted.length - 1];

	if (!first || !last) return fallback;
	if (time <= first.time) return first.value;
	if (time >= last.time) return last.value;

	for (let i = 0; i < sorted.length - 1; i++) {
		const left = sorted[i];
		const right = sorted[i + 1];
		if (time < left.time || time > right.time) continue;
		if (left.interpolation === "hold") return left.value;
		const t = (time - left.time) / (right.time - left.time);
		return left.value + (right.value - left.value) * t;
	}

	return last.value;
}
