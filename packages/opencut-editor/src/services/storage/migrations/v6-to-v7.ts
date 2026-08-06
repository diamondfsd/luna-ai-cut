import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV6ToV7 } from "./transformers/v6-to-v7";

export class V6toV7Migration extends StorageMigration {
	from = 6;
	to = 7;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV6ToV7({ project });
	}
}
