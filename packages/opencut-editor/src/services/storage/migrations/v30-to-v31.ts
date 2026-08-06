import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV30ToV31 } from "./transformers/v30-to-v31";

export class V30toV31Migration extends StorageMigration {
	from = 30;
	to = 31;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV30ToV31({ project });
	}
}
