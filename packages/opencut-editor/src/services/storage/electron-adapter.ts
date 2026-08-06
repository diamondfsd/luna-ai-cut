import type { StorageAdapter } from "./types";

type OpenCutStorageApi = {
	getJson(namespace: string, key: string): Promise<unknown | null>;
	setJson(namespace: string, key: string, value: unknown): Promise<void>;
	getBinary(namespace: string, key: string): Promise<Uint8Array | null>;
	setBinary(namespace: string, key: string, value: Uint8Array): Promise<void>;
	remove(namespace: string, key: string): Promise<void>;
	list(namespace: string, extension: "json" | "bin"): Promise<string[]>;
	clear(namespace: string): Promise<void>;
	capacity(): Promise<{ availableBytes: number }>;
};

export function getElectronStorageApi(): OpenCutStorageApi {
	const api = (window as unknown as { openCutStorage?: OpenCutStorageApi }).openCutStorage;
	if (!api) throw new Error("OpenCut local storage is unavailable");
	return api;
}

export class ElectronJsonAdapter<T> implements StorageAdapter<T> {
	constructor(private readonly namespace: string) {}

	async get(key: string): Promise<T | null> {
		return (await getElectronStorageApi().getJson(this.namespace, key)) as T | null;
	}

	async set({ key, value }: { key: string; value: T }): Promise<void> {
		await getElectronStorageApi().setJson(this.namespace, key, value);
	}

	async remove(key: string): Promise<void> {
		await getElectronStorageApi().remove(this.namespace, key);
	}

	async list(): Promise<string[]> {
		return await getElectronStorageApi().list(this.namespace, "json");
	}

	async getAll(): Promise<T[]> {
		const keys = await this.list();
		const values: T[] = [];
		for (const key of keys) {
			const value = await this.get(key);
			if (value !== null) values.push(value);
		}
		return values;
	}

	async clear(): Promise<void> {
		await getElectronStorageApi().clear(this.namespace);
	}
}

export class ElectronFileAdapter implements StorageAdapter<File> {
	constructor(private readonly namespace: string) {}

	async get(key: string): Promise<File | null> {
		const data = await getElectronStorageApi().getBinary(this.namespace, key);
		return data ? new File([data], key) : null;
	}

	async set({ key, value }: { key: string; value: File }): Promise<void> {
		await getElectronStorageApi().setBinary(
			this.namespace,
			key,
			new Uint8Array(await value.arrayBuffer()),
		);
	}

	async remove(key: string): Promise<void> {
		await getElectronStorageApi().remove(this.namespace, key);
	}

	async list(): Promise<string[]> {
		return await getElectronStorageApi().list(this.namespace, "bin");
	}

	async clear(): Promise<void> {
		await getElectronStorageApi().clear(this.namespace);
	}
}
