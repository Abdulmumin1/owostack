import { createFileRoute, notFound } from "@tanstack/react-router";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { createServerFn } from "@tanstack/react-start";
import { source } from "@/lib/source";
import browserCollections from "fumadocs-mdx:collections/browser";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { APIPage } from "@/components/api-page";
import { baseOptions } from "@/lib/layout.shared";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { Suspense } from "react";

export const Route = createFileRoute("/$")({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/") ?? [];
    const data = await serverLoader({ data: slugs });
    await clientLoader.preload(data.path);
    return data;
  },
  head: ({ loaderData }) => {
    const title = loaderData?.title
      ? `${loaderData.title} - Owostack Docs`
      : "Owostack Docs";

    const description =
      loaderData?.description ||
      "Developer-friendly billing infrastructure. 3 API calls. Zero webhooks.";

    const getOgImage = (pageTitle?: string, pageDescription?: string) => {
      if (!pageTitle) return "https://owostack.com/og.jpg";
      const cloudName = "dtrqaqezs";
      const baseImageId = "og-plain_unfcap";
      const encodedTitle = encodeURIComponent(encodeURIComponent(pageTitle));

      // Use west gravity to automatically center the block vertically on the left side.
      // We offset the title slightly up (y=-40) to leave room for the description.
      let overlay = `l_text:Arial_45_bold:${encodedTitle},c_fit,w_480,co_rgb:ececec/fl_layer_apply,g_west,x_70,y_-40`;

      if (pageDescription) {
        // truncate description to avoid vertical overflow on the OG image
        const shortDesc =
          pageDescription.length > 120
            ? pageDescription.substring(0, 117) + "..."
            : pageDescription;
        const encodedDesc = encodeURIComponent(encodeURIComponent(shortDesc));

        // Stack title and description using west gravity.
        // The title shifts up slightly (y=-60) and the description shifts down (y=110).
        // This creates a perfectly centered text block regardless of line breaks.
        overlay = `l_text:Arial_45_bold:${encodedTitle},c_fit,w_480,co_rgb:ececec/fl_layer_apply,g_west,x_70,y_-35/l_text:Arial_30:${encodedDesc},c_fit,w_480,co_rgb:b3b3b3/fl_layer_apply,g_west,x_70,y_110`;
      }

      return `https://res.cloudinary.com/${cloudName}/image/upload/f_jpg,q_70,w_1200,h_630,c_fill/${overlay}/${baseImageId}.png`;
    };

    const ogImage = getOgImage(loaderData?.title, loaderData?.description);

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:image", content: ogImage },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: ogImage },
      ],
    };
  },
});

const serverLoader = createServerFn({
  method: "GET",
})
  .inputValidator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs);
    if (!page) throw notFound();

    return {
      path: page.path,
      title: page.data.title,
      description: page.data.description,
      pageTree: await source.serializePageTree(source.getPageTree()),
    };
  });

const clientLoader = browserCollections.docs.createClientLoader({
  component(
    { toc, frontmatter, default: MDX },
    // you can define props for the component
    props: {
      className?: string;
    },
  ) {
    return (
      <DocsPage toc={toc} full={frontmatter.full} {...props}>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <DocsBody>
          <MDX
            components={{
              ...defaultMdxComponents,
              APIPage,
            }}
          />
        </DocsBody>
      </DocsPage>
    );
  },
});

function Page() {
  const data = useFumadocsLoader(Route.useLoaderData());

  return (
    <DocsLayout {...baseOptions()} tree={data.pageTree}>
      <Suspense>
        {clientLoader.useContent(data.path, {
          className: "",
        })}
      </Suspense>
    </DocsLayout>
  );
}
