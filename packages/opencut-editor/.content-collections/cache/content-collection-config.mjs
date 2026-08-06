// content-collections.ts
import { defineCollection, defineConfig } from "@content-collections/core";
import { z } from "zod";
var changelog = defineCollection({
  name: "changelog",
  directory: "src/lib/changelog/entries",
  include: "*.md",
  schema: z.object({
    content: z.string(),
    version: z.string(),
    date: z.string(),
    published: z.boolean().default(true),
    title: z.string(),
    description: z.string().optional(),
    summary: z.string().optional(),
    changes: z.array(
      z.object({
        type: z.string(),
        text: z.string()
      })
    )
  }),
  transform: async (doc, { collection }) => {
    const allDocs = await collection.documents();
    const publishedDocs = allDocs.filter((entry) => entry.published !== false);
    const sorted = [...publishedDocs].sort(
      (a, b) => b.version.localeCompare(a.version, void 0, { numeric: true })
    );
    const isLatest = doc.published !== false && sorted[0]?.version === doc.version;
    return { ...doc, isLatest };
  }
});
var content_collections_default = defineConfig({
  content: [changelog]
});
export {
  content_collections_default as default
};
