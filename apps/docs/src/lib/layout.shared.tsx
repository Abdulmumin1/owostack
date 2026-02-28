import { BookIcon, LayoutIcon, TerminalIcon, GithubIcon } from "lucide-react";
import type { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import * as React from "react";

export function baseOptions(): Omit<DocsLayoutProps, "tree"> {
  return {
    nav: {
      title: (
        <div className="flex items-center gap-2">
            <svg width="40" height="40" viewBox="-28 -28 456.00 456.00" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round" stroke="#CCCCCC" stroke-width="1.6"></g><g id="SVGRepo_iconCarrier"> <path d="M153.07 298.246C157.327 282.988 32.1068 74.7113 90.5871 103.778C108.175 112.519 115.595 135.39 125.822 151.654" stroke="#e8a855" stroke-opacity="0.9" stroke-width="10.4" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M162.816 213.411C140.163 220.072 124.104 128.475 148.647 133.387C151.663 133.993 156.651 146.925 157.754 146.557C160.19 145.747 161.207 128.35 163.828 125.283C176.44 110.554 186.07 124.27 196.207 126.297C204.007 127.86 216.411 96.3653 233.647 122.247C236.65 126.756 258.926 169.356 259.956 168.84C269.019 164.306 295.617 101 323.962 122.247C330.476 127.13 317.622 155.464 308.201 177.747C288.35 224.699 234.044 280.099 231.622 293.435" stroke="#e8a855" stroke-opacity="0.9" stroke-width="10.4" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M159.937 148.508C172.565 244.124 218.121 205.637 193.994 134.623" stroke="#e8a855" stroke-opacity="0.9" stroke-width="10.4" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M201.285 163.114C221.116 223.873 237.225 179.469 227.476 146.395" stroke="#e8a855" stroke-opacity="0.9" stroke-width="10.4" stroke-linecap="round" stroke-linejoin="round"></path> </g></svg>
          <span className="font-bold text-lg">Owostack</span>
        </div>
      ),
      url: "/",
      transparentMode: "top",
    },
    sidebar: {
      collapsible: true,
      tabs: {
        transform: (option, node) => {
          const icons: Record<string, React.ReactElement> = {
            "api-reference": <TerminalIcon className="size-4" />,
          };
          return {
            ...option,
            icon: icons[node.name] ?? <BookIcon className="size-4" />,
          };
        },
      },
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
