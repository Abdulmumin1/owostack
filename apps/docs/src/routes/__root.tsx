import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import * as React from "react";
import appCss from "@/styles/app.css?url";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import { FloatingNav } from "@/components/FloatingNav";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Owostack - Billing infrastructure for AI SaaS",
      },
      {
        name: "description",
        content:
          "Developer-friendly billing infrastructure. 3 API calls. Zero webhooks. Usage metering, subscriptions, and feature gating with multi-provider support.",
      },
      {
        property: "og:type",
        content: "website",
      },
      {
        property: "og:title",
        content: "Owostack - Billing infrastructure for AI SaaS",
      },
      {
        property: "og:description",
        content:
          "Developer-friendly billing infrastructure. 3 API calls. Zero webhooks. Usage metering, subscriptions, and feature gating with multi-provider support.",
      },
      {
        property: "og:image",
        content: "https://owostack.com/og.jpg",
      },
      {
        name: "twitter:card",
        content: "summary_large_image",
      },
      {
        name: "twitter:title",
        content: "Owostack - Billing infrastructure for AI SaaS",
      },
      {
        name: "twitter:description",
        content:
          "Developer-friendly billing infrastructure. 3 API calls. Zero webhooks. Usage metering, subscriptions, and feature gating with multi-provider support.",
      },
      {
        name: "twitter:image",
        content: "https://owostack.com/og.jpg",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="flex flex-col min-h-screen relative">
        <RootProvider>{children}</RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
