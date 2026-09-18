"use client";

import { CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import type {
  Folder as PageTreeFolder,
  Item as PageTreeItem,
  Separator as PageTreeSeparator,
} from "fumadocs-core/page-tree";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { Link, useLocation } from "@tanstack/react-router";
import type { FC, ReactNode } from "react";
import { useState } from "react";

// ─── Item ───────────────────────────────────────────────────────────────────

export const CustomItem: FC<{ item: PageTreeItem }> = ({ item }) => {
  const pathname = useLocation().pathname;
  const active = pathname === item.url;

  return (
    <Link
      to={item.url}
      target={item.external ? "_blank" : undefined}
      rel={item.external ? "noopener noreferrer" : undefined}
      data-active={active}
      className="docs-nav-item relative flex items-center gap-2.5 px-4 py-[7px] text-[14px] leading-snug transition-colors"
    >
      <span className="truncate">{item.name}</span>
    </Link>
  );
};

// ─── Folder ─────────────────────────────────────────────────────────────────

export const CustomFolder: FC<{
  item: PageTreeFolder;
  children: ReactNode;
}> = ({ item, children }) => {
  const pathname = useLocation().pathname;

  const containsActive = hasActiveChild(item, pathname);
  const [open, setOpen] = useState(item.defaultOpen ?? containsActive);

  return (
    <div className="docs-nav-folder flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="docs-nav-folder-trigger flex w-full items-center gap-2.5 px-4 py-2.5 text-[14px] font-medium text-foreground transition-colors cursor-pointer"
      >
        {item.icon && (
          <span className="docs-nav-folder-icon shrink-0 text-foreground/80 [&_svg]:size-4">
            {item.icon}
          </span>
        )}
        <span className="truncate">{item.name}</span>
        <CaretRight
          size={12}
          weight="bold"
          className={`ml-auto shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
      </button>

      {item.index && <CustomItem item={item.index} />}

      <div
        className="grid transition-[grid-template-rows] duration-200"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="pb-1">{children}</div>
        </div>
      </div>
    </div>
  );
};

// ─── Separator ──────────────────────────────────────────────────────────────

export const CustomSeparator: FC<{ item: PageTreeSeparator }> = ({ item }) => {
  if (!item.name) return <div className="my-3 h-px bg-border" />;
  return (
    <div className="docs-nav-separator mt-6 mb-1 px-4 first:mt-1">
      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
        {item.name}
      </span>
    </div>
  );
};

// ─── Search Button (sidebar banner) ─────────────────────────────────────────

export const SearchButton: FC = () => {
  const { setOpenSearch: setOpen } = useSearchContext();

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="docs-search flex w-full items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2 text-[14px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground cursor-pointer"
    >
      <MagnifyingGlass size={15} className="shrink-0" />
      <span className="truncate">Search</span>
      <kbd className="ml-auto hidden items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
        ⌘K
      </kbd>
    </button>
  );
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function hasActiveChild(folder: PageTreeFolder, pathname: string): boolean {
  if (folder.index?.url === pathname) return true;
  for (const child of folder.children) {
    if (child.type === "page" && child.url === pathname) return true;
    if (child.type === "folder" && hasActiveChild(child, pathname)) return true;
  }
  return false;
}
