import { defineConfig } from "vitest/config";
import tsConfigPaths from "vite-tsconfig-paths";
import mdx from "fumadocs-mdx/vite";

export default defineConfig({
  plugins: [
    // Same content pipeline as vite.config.ts so tests can load the real page
    // source (e.g. to assert every redirect target is an existing page).
    mdx(await import("./source.config")),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
