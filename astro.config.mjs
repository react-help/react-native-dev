import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://react-native.dev',
  output: 'static',
  trailingSlash: 'ignore',
  build: { inlineStylesheets: 'always' },
});
