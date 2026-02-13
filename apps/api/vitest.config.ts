export default {
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "cloudflare:workers": new URL(
        "./test/mocks/cloudflare-workers.ts",
        import.meta.url,
      ).pathname,
    },
  },
};
