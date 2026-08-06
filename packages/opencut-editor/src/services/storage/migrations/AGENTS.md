# Agents.md

## Migration Data Policy

Migrations are additive only.

- Do not delete, rename, or replace persisted data in a migration.
- When a new storage shape is needed, add the new fields alongside the old fields.
- Runtime code may prefer or ignore old fields, but the migration must preserve them for future down migrations.
- If old data should ever be removed, that is a separate explicit cleanup task, not part of a version migration.