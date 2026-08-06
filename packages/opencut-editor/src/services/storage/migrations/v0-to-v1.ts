import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV0ToV1 } from "./transformers/v0-to-v1";

export class V0toV1Migration extends StorageMigration {
	from = 0;
	to = 1;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV0ToV1({ project });
	}
}
