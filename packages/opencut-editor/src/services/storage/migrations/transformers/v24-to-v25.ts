import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV24ToV25({
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
	if (version >= 25) {
		return { project, skipped: true, reason: "already v25" };
	}
	if (version !== 24) {
		return { project, skipped: true, reason: "not v24" };
	}

	return {
		project: {
			...migrateProject({ project }),
			version: 25,
		},
		skipped: false,
	};
}

function migrateProject({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	if (!Array.isArray(project.scenes)) {
		return project;
	}

	return {
		...project,
		scenes: project.scenes.map((scene) => migrateScene({ scene })),
	};
}

function migrateScene({ scene }: { scene: unknown }): unknown {
	if (!isRecord(scene) || !isRecord(scene.tracks)) {
		return scene;
	}

	const tracks = scene.tracks;
	const nextTracks: ProjectRecord = { ...tracks };

	if (isRecord(tracks.main)) {
		nextTracks.main = migrateTrack({ track: tracks.main });
	}

	if (Array.isArray(tracks.overlay)) {
		nextTracks.overlay = tracks.overlay.map((track) =>
			migrateTrack({ track }),
		);
	}

	if (Array.isArray(tracks.audio)) {
		nextTracks.audio = tracks.audio.map((track) => migrateTrack({ track }));
	}

	return { ...scene, tracks: nextTracks };
}

function migrateTrack({ track }: { track: unknown }): unknown {
	if (!isRecord(track) || !Array.isArray(track.elements)) {
		return track;
	}

	return {
		...track,
		elements: track.elements.map((element) => migrateElement({ element })),
	};
}

function migrateElement({ element }: { element: unknown }): unknown {
	if (!isRecord(element) || !isRecord(element.animations)) {
		return element;
	}

	const nextAnimations = migrateAnimations({ animations: element.animations });
	if (nextAnimations === element.animations) {
		return element;
	}

	return { ...element, animations: nextAnimations };
}

function migrateAnimations({
	animations,
}: {
	animations: ProjectRecord;
}): ProjectRecord {
	if (!isRecord(animations.bindings) || !isRecord(animations.channels)) {
		return animations;
	}

	const positionBinding = animations.bindings["transform.position"];
	if (!isRecord(positionBinding) || positionBinding.kind !== "vector2") {
		return animations;
	}

	const xChannel = animations.channels["transform.position:x"];
	const yChannel = animations.channels["transform.position:y"];

	const nextBindings: ProjectRecord = { ...animations.bindings };
	const nextChannels: ProjectRecord = { ...animations.channels };

	delete nextBindings["transform.position"];
	delete nextChannels["transform.position:x"];
	delete nextChannels["transform.position:y"];

	nextBindings["transform.positionX"] = {
		path: "transform.positionX",
		kind: "number",
		components: [{ key: "value", channelId: "transform.positionX:value" }],
	};
	nextBindings["transform.positionY"] = {
		path: "transform.positionY",
		kind: "number",
		components: [{ key: "value", channelId: "transform.positionY:value" }],
	};

	if (isRecord(xChannel)) {
		nextChannels["transform.positionX:value"] = xChannel;
	}
	if (isRecord(yChannel)) {
		nextChannels["transform.positionY:value"] = yChannel;
	}

	return { ...animations, bindings: nextBindings, channels: nextChannels };
}
