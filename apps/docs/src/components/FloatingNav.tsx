import * as React from "react";
import { Link, useLocation } from "@tanstack/react-router";

export function FloatingNav() {
  const location = useLocation();
  const pathname = location.pathname;

  const links = [
    { text: "Docs", url: "/" },
    { text: "SDK", url: "/sdk/configuration" },
    { text: "Reference", url: "/api-reference" },
    { text: "CLI", url: "/cli" },
  ];

  const isActive = (url: string) => {
    if (url === "/") {
      return (
        pathname === "/" ||
        (pathname !== "/" &&
          !pathname.startsWith("/sdk") &&
          !pathname.startsWith("/cli") &&
          !pathname.startsWith("/api-reference") &&
          !pathname.startsWith("/api/"))
      );
    }
    return pathname.startsWith(url);
  };

  return (
    <div className="fixed top-auto bottom-6  left-1/2 -translate-x-1/2 z-[100] pointer-events-none">
      <nav className="flex items-center gap-0.5 p-1 bg-[#1a1a1a]/90 backdrop-blur-md border border-[#333333] rounded-full shadow-2xl pointer-events-auto">
        {links.map((link) => {
          const active = isActive(link.url);
          return (
            <Link
              key={link.url}
              to={link.url}
              className={`px-3.5 py-1.5 rounded-full text-[10px] sm:text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${
                active
                  ? "bg-[#f0b860] text-[#131313] shadow-md scale-105"
                  : "text-[#808080] hover:text-[#f5f5f5] hover:bg-white/5"
              }`}
            >
              {link.text}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
