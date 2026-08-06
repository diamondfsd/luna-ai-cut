import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV29ToV30 } from "./transformers/v29-to-v30";

export class V29toV30Migration extends StorageMigration {
	from = 29;
	to = 30;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV29ToV30({ project });
	}
}
