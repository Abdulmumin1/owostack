import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      routes: {
        include: ['/*'],
        exclude: ['<all>']
      }
    }),
    alias: {
      $components: 'src/lib/components',
      $stores: 'src/lib/stores',
      $api: 'src/lib/api'
    }
  }
};

export default config;
