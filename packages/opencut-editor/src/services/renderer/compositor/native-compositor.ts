import {
	incrementCounter,
	isRenderPerfEnabled,
	recordWasmFrameProfile,
} from "@/diagnostics/render-perf";
import type {
	ExternalTextureDescriptor,
	FrameDescriptor,
	RenderedTextureDescriptor,
	TextureUploadDescriptor,
} from "./types";
import type { EffectPass } from "@/effects/types";

type OpenCutRenderCoreApi = {
	openCutInit(): Promise<void>;
	openCutUpsertTexture(
		id: string,
		data: Uint8Array,
		width: number,
		height: number,
	): Promise<void>;
	openCutReleaseTexture(id: string): Promise<void>;
	openCutRenderFrame(frameJson: string): Promise<Uint8Array>;
};

type RenderedCacheEntry = {
	kind: "rendered";
	canvas: OffscreenCanvas;
	contentHash: string;
	width: number;
	height: number;
};

type ExternalCacheEntry = {
	kind: "external";
	source: CanvasImageSource;
	width: number;
	height: number;
};

class NativeCompositor {
	private canvas: HTMLCanvasElement | null = null;
	private context: CanvasRenderingContext2D | null = null;
	private initializedSize: { width: number; height: number } | null = null;
	private initPromise: Promise<void> | null = null;
	private cache = new Map<string, RenderedCacheEntry | ExternalCacheEntry>();

	ensureInitialized({ width, height }: { width: number; height: number }) {
		if (!this.canvas) {
			this.canvas = document.createElement("canvas");
			this.context = this.canvas.getContext("2d");
			if (!this.context) throw new Error("Failed to initialize OpenCut output canvas");
		}
		if (!this.initializedSize || this.initializedSize.width !== width || this.initializedSize.height !== height) {
			this.canvas.width = width;
			this.canvas.height = height;
			this.initializedSize = { width, height };
		}
	}

	getCanvas(): HTMLCanvasElement {
		if (!this.canvas) throw new Error("Compositor is not initialized");
		return this.canvas;
	}

	async syncTextures(textures: TextureUploadDescriptor[]) {
		await this.initializeNative();
		const api = getOpenCutApi();
		const nextIds = new Set(textures.map((texture) => texture.id));
		for (const previousId of this.cache.keys()) {
			if (!nextIds.has(previousId)) {
				await api.openCutReleaseTexture(previousId);
				this.cache.delete(previousId);
			}
		}

		for (const texture of textures) {
			if (texture.kind === "external") await this.syncExternalTexture(texture);
			else await this.syncRenderedTexture(texture);
		}
	}

	async render(frame: FrameDescriptor) {
		await this.initializeNative();
		if (!this.context) throw new Error("Compositor is not initialized");
		const startedAt = performance.now();
		const pixels = await getOpenCutApi().openCutRenderFrame(JSON.stringify(frame));
		const view = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength);
		this.context.putImageData(new ImageData(view, frame.width, frame.height), 0, 0);
		if (isRenderPerfEnabled()) {
			recordWasmFrameProfile([{ name: "nativeOpenCutFrame", durationMs: performance.now() - startedAt }]);
		}
	}

	private initializeNative(): Promise<void> {
		this.initPromise ??= getOpenCutApi().openCutInit();
		return this.initPromise;
	}

	private async syncExternalTexture(texture: ExternalTextureDescriptor) {
		const previous = this.cache.get(texture.id);
		if (
			previous?.kind === "external" &&
			previous.source === texture.source &&
			previous.width === texture.width &&
			previous.height === texture.height
		) {
			incrementCounter({ name: "textureCacheHit" });
			return;
		}

		const canvas = ensureOffscreenCanvas({
			source: texture.source,
			width: texture.width,
			height: texture.height,
			label: `texture upload ${texture.id}`,
		});
		await this.uploadCanvas(texture.id, canvas, texture.width, texture.height);
		this.cache.set(texture.id, {
			kind: "external",
			source: texture.source,
			width: texture.width,
			height: texture.height,
		});
	}

	private async syncRenderedTexture(texture: RenderedTextureDescriptor) {
		const previous = this.cache.get(texture.id);
		if (
			previous?.kind === "rendered" &&
			previous.contentHash === texture.contentHash &&
			previous.width === texture.width &&
			previous.height === texture.height
		) {
			incrementCounter({ name: "textureCacheHit" });
			return;
		}

		const canvas =
			previous?.kind === "rendered" && previous.width === texture.width && previous.height === texture.height
				? previous.canvas
				: createBackingCanvas({ width: texture.width, height: texture.height });
		const context = canvas.getContext("2d");
		if (!context) throw new Error(`Failed to get 2d context for texture ${texture.id}`);
		context.clearRect(0, 0, texture.width, texture.height);
		texture.draw(context);
		await this.uploadCanvas(texture.id, canvas, texture.width, texture.height);
		this.cache.set(texture.id, {
			kind: "rendered",
			canvas,
			contentHash: texture.contentHash,
			width: texture.width,
			height: texture.height,
		});
	}

	private async uploadCanvas(id: string, canvas: OffscreenCanvas, width: number, height: number) {
		const context = canvas.getContext("2d");
		if (!context) throw new Error(`Failed to read pixels for texture ${id}`);
		incrementCounter({ name: "textureUpload" });
		incrementCounter({ name: "textureUploadPixels", by: width * height });
		const pixels = context.getImageData(0, 0, width, height).data;
		await getOpenCutApi().openCutUpsertTexture(
			id,
			new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
			width,
			height,
		);
	}
}

export const nativeCompositor = new NativeCompositor();

export async function renderNativeEffectPreview({
	source,
	width,
	height,
	passes,
}: {
	source: OffscreenCanvas;
	width: number;
	height: number;
	passes: EffectPass[];
}): Promise<ImageData> {
	const api = getOpenCutApi();
	await api.openCutInit();
	const textureId = `effect-preview-${crypto.randomUUID()}`;
	const context = source.getContext("2d");
	if (!context) throw new Error("Failed to read effect preview source");
	const sourcePixels = context.getImageData(0, 0, width, height).data;
	await api.openCutUpsertTexture(
		textureId,
		new Uint8Array(sourcePixels.buffer, sourcePixels.byteOffset, sourcePixels.byteLength),
		width,
		height,
	);
	try {
		const frame: FrameDescriptor = {
			width,
			height,
			clear: { color: [0, 0, 0, 1] },
			items: [{
				type: "layer",
				textureId,
				transform: {
					centerX: width / 2,
					centerY: height / 2,
					width,
					height,
					rotationDegrees: 0,
					flipX: false,
					flipY: false,
				},
				opacity: 1,
				blendMode: "normal",
				effectPassGroups: [passes],
				mask: null,
			}],
		};
		const pixels = await api.openCutRenderFrame(JSON.stringify(frame));
		return new ImageData(
			new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength),
			width,
			height,
		);
	} finally {
		await api.openCutReleaseTexture(textureId);
	}
}

function getOpenCutApi(): OpenCutRenderCoreApi {
	const api = (window as unknown as { lunaRenderCore?: Partial<OpenCutRenderCoreApi> }).lunaRenderCore;
	if (
		!api?.openCutInit ||
		!api.openCutUpsertTexture ||
		!api.openCutReleaseTexture ||
		!api.openCutRenderFrame
	) {
		throw new Error("OpenCut native renderer is unavailable");
	}
	return api as OpenCutRenderCoreApi;
}

function createBackingCanvas({ width, height }: { width: number; height: number }): OffscreenCanvas {
	if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas is not supported");
	return new OffscreenCanvas(width, height);
}

function ensureOffscreenCanvas({
	source,
	width,
	height,
	label,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
	label: string;
}): OffscreenCanvas {
	if (source instanceof OffscreenCanvas) return source;
	const canvas = createBackingCanvas({ width, height });
	const context = canvas.getContext("2d");
	if (!context) throw new Error(`Failed to get 2d context for ${label}`);
	context.clearRect(0, 0, width, height);
	context.drawImage(source, 0, 0, width, height);
	return canvas;
}
