import type { FeedbackEntry } from "@/feedback/types";
import type { SoundEffect } from "@/sounds/types";

export interface SoundSearchRequest {
	query?: string;
	type?: "songs" | "effects";
	page?: number;
	pageSize?: number;
	sort?: "downloads" | "rating" | "created" | "score";
	minRating?: number;
	commercialOnly?: boolean;
}

export interface SoundSearchResult {
	count: number;
	next: string | null;
	previous: string | null;
	results: SoundEffect[];
	page: number;
	pageSize: number;
}

type OpenCutServicesApi = {
	searchSounds(request: SoundSearchRequest): Promise<SoundSearchResult>;
	submitFeedback(message: string): Promise<FeedbackEntry>;
};

function getApi(): OpenCutServicesApi {
	const api = (window as unknown as { openCutServices?: OpenCutServicesApi }).openCutServices;
	if (!api) throw new Error("OpenCut desktop services are unavailable");
	return api;
}

export async function searchSounds(request: SoundSearchRequest): Promise<SoundSearchResult> {
	return await getApi().searchSounds(request);
}

export async function submitFeedback(message: string): Promise<FeedbackEntry> {
	return await getApi().submitFeedback(message);
}
