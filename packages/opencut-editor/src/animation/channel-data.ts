import type {
	AnimationChannel,
	ChannelData,
	CompositeChannelData,
} from "@/animation/types";

const LEGACY_ANIMATION_STORAGE_KEYS = new Set(["bindings", "channels"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function isLeafChannelData(
	data: ChannelData | undefined,
): data is AnimationChannel {
	return isRecord(data) && Array.isArray(data.keys);
}

export function isCompositeChannelData(
	data: ChannelData | undefined,
): data is CompositeChannelData {
	return isRecord(data) && !Array.isArray(data.keys);
}

export function getChannelsFromData({
	data,
}: {
	data: ChannelData | undefined;
}): AnimationChannel[] {
	if (isLeafChannelData(data)) {
		return [data];
	}
	if (!isCompositeChannelData(data)) {
		return [];
	}
	return Object.values(data).filter(isLeafChannelData);
}

export function getChannelEntriesFromData({
	data,
}: {
	data: ChannelData | undefined;
}): Array<[string, AnimationChannel]> {
	if (isLeafChannelData(data)) {
		return [["value", data]];
	}
	if (!isCompositeChannelData(data)) {
		return [];
	}
	return Object.entries(data).flatMap(([componentKey, channel]) =>
		isLeafChannelData(channel) ? [[componentKey, channel]] : [],
	);
}

export function isAnimationStorageKey({ key }: { key: string }): boolean {
	return !LEGACY_ANIMATION_STORAGE_KEYS.has(key);
}
