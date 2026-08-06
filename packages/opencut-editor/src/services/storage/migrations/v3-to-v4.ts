import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV3ToV4 } from "./transformers/v3-to-v4";

export class V3toV4Migration extends StorageMigration {
	from = 3;
	to = 4;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV3ToV4({ project });
	}
}
