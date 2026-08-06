import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV2ToV3 } from "./transformers/v2-to-v3";

export class V2toV3Migration extends StorageMigration {
	from = 2;
	to = 3;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV2ToV3({ project });
	}
}
