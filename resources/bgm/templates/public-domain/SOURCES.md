# Public-Domain Melody Seeds

These 48 DSL files were converted from the CC0 song data in
[pepperhorn/opensongs-json](https://github.com/pepperhorn/opensongs-json),
source commit `3a0a6ff8c5d6beff3a59a2058c094aa43811946b`.

The upstream project describes its song data as CC0-1.0 and provides normalized
`song.json` event lists. This project keeps 6 seeds each from the `first`,
`nursery`, `folk`, `australian`, `classical`, `seasonal`, `carol`, and `jazz`
categories. The original source title, composer, URL, commit, and license are
retained in each `.bgm` file and in `index.json`, along with scene tags such as
`education`, `documentary`, `travel`, `cinematic`, `holiday`, and `vintage`.

The conversion is reproducible with Node.js:

```bash
node scripts/import_public_domain.mjs \
  --input /path/to/song.json \
  --output templates/public-domain/example.bgm \
  --source-commit 3a0a6ff8c5d6beff3a59a2058c094aa43811946b
```

To reproduce the complete 48-seed catalog with `gh`:

```bash
node scripts/import_public_domain_batch.mjs
```

The batch importer reads only the pinned GitHub commit and requires an explicit
CC0 source. Use `--per-category N` for a smaller development catalog.

These are reference seeds, not finished arrangements. The agent should change
the accompaniment, tempo, register, velocity, repetition, and sometimes the
melody before using one as a video soundtrack. Do not add lyrics or vocals to a
background-music render unless requested.
