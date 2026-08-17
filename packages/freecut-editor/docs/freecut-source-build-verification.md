# FreeCut Source Build Verification

The following paths are tracked source files and must remain visible to Git:

- `src/infrastructure/gpu-effects/effects/distort.ts` is imported by the GPU effect registry.
- `src/routes/docs/index.tsx` and `src/routes/docs/$slug.tsx` are imported by the generated TanStack route tree.

The repository has broad `docs/` and `dist*` ignore patterns for documentation artifacts and build output. Exact exceptions for the source paths above are kept in the root `.gitignore`; do not replace them with a broad unignore rule.

## Verification

Run the FreeCut type check from the repository root:

```bash
pnpm --filter @luna/freecut-editor exec tsc --noEmit -p tsconfig.luna.json
```

For the application build, run:

```bash
pnpm run build:app
```

The TanStack route tree is generated into `src/routeTree.gen.ts`. When route files change, regenerate it with the package's existing route-generation command before running the type check.
