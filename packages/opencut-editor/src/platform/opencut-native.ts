export interface FrameRate {
	numerator: number;
	denominator: number;
}

export type MediaTime = number;
export type TimeCodeFormat =
	| "MM:SS"
	| "HH:MM:SS"
	| "HH:MM:SS:CS"
	| "HH:MM:SS:FF";

const MEDIA_TICKS_PER_SECOND = 120_000;

export function TICKS_PER_SECOND(): number {
	return MEDIA_TICKS_PER_SECOND;
}

function ticksPerFrame(rate: FrameRate): number | undefined {
	if (rate.numerator <= 0 || rate.denominator <= 0) return undefined;
	const numerator = MEDIA_TICKS_PER_SECOND * rate.denominator;
	if (!Number.isSafeInteger(numerator) || numerator % rate.numerator !== 0) {
		return undefined;
	}
	return numerator / rate.numerator;
}

function roundHalfAwayFromZero(value: number): number {
	const magnitude = Math.round(Math.abs(value));
	return magnitude === 0 ? 0 : value < 0 ? -magnitude : magnitude;
}

export function mediaTimeFromSeconds({ seconds }: { seconds: number }): MediaTime | undefined {
	if (!Number.isFinite(seconds)) return undefined;
	const ticks = roundHalfAwayFromZero(seconds * MEDIA_TICKS_PER_SECOND);
	return Number.isSafeInteger(ticks) ? ticks : undefined;
}

export function mediaTimeToSeconds({ time }: { time: MediaTime }): number {
	return time / MEDIA_TICKS_PER_SECOND;
}

export function roundToFrame({ time, rate }: { time: MediaTime; rate: FrameRate }): MediaTime | undefined {
	const frameTicks = ticksPerFrame(rate);
	if (frameTicks === undefined) return undefined;
	const frame = Math.floor(time / frameTicks);
	const remainder = time - frame * frameTicks;
	return (remainder * 2 >= frameTicks ? frame + 1 : frame) * frameTicks;
}

export function lastFrameTime({ duration, rate }: { duration: MediaTime; rate: FrameRate }): MediaTime | undefined {
	if (duration <= 0) return 0;
	const frameTicks = ticksPerFrame(rate);
	if (frameTicks === undefined) return undefined;
	return Math.floor((duration - 1) / frameTicks) * frameTicks;
}

export function snappedSeekTime({
	time,
	duration,
	rate,
}: {
	time: MediaTime;
	duration: MediaTime;
	rate: FrameRate;
}): MediaTime | undefined {
	const snapped = roundToFrame({ time, rate });
	return snapped === undefined ? undefined : Math.min(Math.max(snapped, 0), duration);
}

export function formatTimecode({
	time,
	format = "HH:MM:SS:CS",
	rate,
}: {
	time: MediaTime;
	format?: TimeCodeFormat;
	rate?: FrameRate;
}): string | undefined {
	const totalTicks = Math.max(0, Math.trunc(time));
	const totalSeconds = Math.floor(totalTicks / MEDIA_TICKS_PER_SECOND);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const secondTicks = totalTicks % MEDIA_TICKS_PER_SECOND;
	const pad = (value: number) => String(value).padStart(2, "0");

	if (format === "MM:SS") return `${pad(minutes)}:${pad(seconds)}`;
	if (format === "HH:MM:SS") return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
	if (format === "HH:MM:SS:CS") {
		const centiseconds = Math.floor(secondTicks / 1_200);
		return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(centiseconds)}`;
	}
	if (!rate) return undefined;
	const frameTicks = ticksPerFrame(rate);
	if (frameTicks === undefined) return undefined;
	const frames = Math.floor(secondTicks / frameTicks);
	return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

export function parseTimecode({
	timeCode,
	format = "HH:MM:SS:CS",
	rate,
}: {
	timeCode: string;
	format?: TimeCodeFormat;
	rate?: FrameRate;
}): MediaTime | undefined {
	if (timeCode.trim() === "") return undefined;
	const parts = timeCode.trim().split(":").map(Number);
	if (parts.some((part) => !Number.isInteger(part) || part < 0)) return undefined;

	if (format === "MM:SS") {
		if (parts.length !== 2 || parts[1] >= 60) return undefined;
		return (parts[0] * 60 + parts[1]) * MEDIA_TICKS_PER_SECOND;
	}
	if (parts.length < 3 || parts[1] >= 60 || parts[2] >= 60) return undefined;
	const base = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * MEDIA_TICKS_PER_SECOND;
	if (format === "HH:MM:SS") return parts.length === 3 ? base : undefined;
	if (parts.length !== 4) return undefined;
	if (format === "HH:MM:SS:CS") return parts[3] < 100 ? base + parts[3] * 1_200 : undefined;
	if (!rate) return undefined;
	const frameTicks = ticksPerFrame(rate);
	const frameUpperBound = Math.ceil(rate.numerator / rate.denominator);
	if (frameTicks === undefined || parts[3] >= frameUpperBound) return undefined;
	return base + parts[3] * frameTicks;
}
