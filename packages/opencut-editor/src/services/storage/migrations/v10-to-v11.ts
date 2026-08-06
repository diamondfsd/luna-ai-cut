import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV10ToV11 } from "./transformers/v10-to-v11";

export class V10toV11Migration extends StorageMigration {
	from = 10;
	to = 11;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV10ToV11({ project });
	}
}
