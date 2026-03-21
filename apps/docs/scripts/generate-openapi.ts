import { readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateFiles } from "fumadocs-openapi";
import { openApiDocument } from "../../api/src/openapi/document";
import { createOpenApiServer } from "../src/lib/openapi-server";

const outputPath = resolve(import.meta.dirname, "../openapi.json");
const apiReferenceDir = resolve(import.meta.dirname, "../content/docs/api-reference");

async function cleanGeneratedReferencePages(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(dir, entry.name);

      if (entry.isDirectory()) {
        await rm(entryPath, { recursive: true, force: true });
        return;
      }

      if (entry.name.endsWith(".mdx") && entry.name !== "index.mdx") {
        await rm(entryPath, { force: true });
      }
    }),
  );
}

await cleanGeneratedReferencePages(apiReferenceDir);

await writeFile(outputPath, `${JSON.stringify(openApiDocument, null, 2)}\n`);

await generateFiles({
  input: createOpenApiServer(openApiDocument as unknown as Record<string, unknown>),
  output: apiReferenceDir,
  includeDescription: true,
});
