import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV8ToV9 } from "./transformers/v8-to-v9";

export class V8toV9Migration extends StorageMigration {
	from = 8;
	to = 9;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV8ToV9({ project });
	}
}
