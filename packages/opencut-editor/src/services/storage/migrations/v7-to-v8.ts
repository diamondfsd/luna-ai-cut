import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV7ToV8 } from "./transformers/v7-to-v8";

export class V7toV8Migration extends StorageMigration {
	from = 7;
	to = 8;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV7ToV8({ project });
	}
}
