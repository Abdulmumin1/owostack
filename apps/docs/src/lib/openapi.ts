import { createOpenAPI } from 'fumadocs-openapi/server';
import spec from '../../openapi.json';

export const openapi = createOpenAPI({
  // Use function form to provide pre-loaded document — avoids filesystem
  // access which isn't available in the Cloudflare Workers SSR environment.
  input: () => ({
    './openapi.json': spec as any,
  }),
});
