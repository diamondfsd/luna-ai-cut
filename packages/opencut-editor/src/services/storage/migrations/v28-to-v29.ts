import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV28ToV29 } from "./transformers/v28-to-v29";

export class V28toV29Migration extends StorageMigration {
	from = 28;
	to = 29;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV28ToV29({ project });
	}
}
