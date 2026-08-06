import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV10ToV11({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project })) {
		return { project, skipped: true, reason: "no project id" };
	}

	if (typeof project.version === "number" && project.version >= 11) {
		return { project, skipped: true, reason: "already v11" };
	}

	const migratedProject = migrateProjectScale({ project });

	return {
		project: { ...migratedProject, version: 11 },
		skipped: false,
	};
}

function migrateProjectScale({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	const scenesValue = project.scenes;
	if (!Array.isArray(scenesValue)) return project;

	const migratedScenes = scenesValue.map((scene) =>
		migrateSceneScale({ scene }),
	);

	return { ...project, scenes: migratedScenes };
}

function migrateSceneScale({ scene }: { scene: unknown }): unknown {
	if (!isRecord(scene)) return scene;

	const tracksValue = scene.tracks;
	if (!Array.isArray(tracksValue)) return scene;

	const migratedTracks = tracksValue.map((track) =>
		migrateTrackScale({ track }),
	);

	return { ...scene, tracks: migratedTracks };
}

function migrateTrackScale({ track }: { track: unknown }): unknown {
	if (!isRecord(track)) return track;

	const elementsValue = track.elements;
	if (!Array.isArray(elementsValue)) return track;

	const migratedElements = elementsValue.map((element) =>
		migrateElementScale({ element }),
	);

	return { ...track, elements: migratedElements };
}

function migrateElementScale({ element }: { element: unknown }): unknown {
	if (!isRecord(element)) return element;

	const transform = element.transform;
	if (!isRecord(transform)) return element;

	const scale = transform.scale;
	if (typeof scale !== "number") return element;

	const migratedTransform = {
		...transform,
		scaleX: scale,
		scaleY: scale,
	};
	delete (migratedTransform as Record<string, unknown>).scale;

	let migratedElement: ProjectRecord = {
		...element,
		transform: migratedTransform,
	};

	const animations = element.animations;
	if (isRecord(animations) && isRecord(animations.channels)) {
		const channels = animations.channels as Record<string, unknown>;
		const scaleChannel = channels["transform.scale"];
		if (scaleChannel && isRecord(scaleChannel)) {
			const keyframes = (scaleChannel as { keyframes?: unknown[] }).keyframes;
			if (Array.isArray(keyframes)) {
				const newChannels = { ...channels };
				delete newChannels["transform.scale"];
				newChannels["transform.scaleX"] = {
					...scaleChannel,
					keyframes: [...keyframes],
				};
				newChannels["transform.scaleY"] = {
					...scaleChannel,
					keyframes: keyframes.map((kf) => (isRecord(kf) ? { ...kf } : kf)),
				};
				migratedElement = {
					...migratedElement,
					animations: { ...animations, channels: newChannels },
				};
			}
		}
	}

	return migratedElement;
}
