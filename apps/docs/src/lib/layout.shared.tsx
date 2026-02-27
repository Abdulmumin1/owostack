import { BookIcon, LayoutIcon, TerminalIcon, GithubIcon } from "lucide-react";
import type { DocsLayoutProps } from "fumadocs-ui/layouts/docs";

export function baseOptions(): Omit<DocsLayoutProps, "tree"> {
  return {
    nav: {
      title: (
        <div className="flex items-center gap-2">
          <LayoutIcon className="size-5 text-blue-600 fill-blue-600" />
          <span className="font-bold text-lg">Owostack</span>
        </div>
      ),
      url: "/docs",
      transparentMode: "top",
    },
    sidebar: {
      collapsible: true,
      tabs: [
        {
          title: "Core",
          description: "The core for Owostack",
          url: "/docs",
          icon: <BookIcon className="size-4" />,
        },
        {
          title: "API",
          description: "The API for Owostack",
          url: "/docs/api-reference",
          icon: <TerminalIcon className="size-4" />,
        },
      ],
    },
    links: [
      {
        text: "GitHub",
        url: "https://github.com/Abdulmumin1/owostack",
        icon: <GithubIcon className="size-4" />,
      },
    ],
  };
}
