import { loader, type LoaderPlugin } from "fumadocs-core/source";
import { docs } from "fumadocs-mdx:collections/server";
import { createElement } from "react";
import * as Phosphor from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";

// Map of icon names used in meta.json / frontmatter -> Phosphor (filled).
// Lucide-style names are aliased so existing content keeps working.
const ALIASES: Record<string, string> = {
  RefreshCw: "ArrowsClockwise",
  Blend: "Intersect",
  Zap: "Lightning",
  Layers: "Stack",
  CreditCard: "CreditCard",
  Gauge: "Gauge",
  Code: "Code",
  Terminal: "Terminal",
  BookOpen: "BookOpen",
  Play: "Play",
};

function resolveIcon(name?: string) {
  if (!name) return undefined;
  const key = ALIASES[name] ?? name;
  const Comp = (Phosphor as unknown as Record<string, Icon | undefined>)[key];
  if (!Comp) return undefined;
  return createElement(Comp, { weight: "fill" });
}

const phosphorIconsPlugin: LoaderPlugin = {
  name: "owostack:phosphor-icons",
  transformPageTree: {
    file(node) {
      if (typeof node.icon === "string" || node.icon === undefined)
        node.icon = resolveIcon(node.icon as string | undefined);
      return node;
    },
    folder(node) {
      if (typeof node.icon === "string" || node.icon === undefined)
        node.icon = resolveIcon(node.icon as string | undefined);
      return node;
    },
    separator(node) {
      if (typeof node.icon === "string" || node.icon === undefined)
        node.icon = resolveIcon(node.icon as string | undefined);
      return node;
    },
  },
};

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: "/",
  plugins: [phosphorIconsPlugin],
});
