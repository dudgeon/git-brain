import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    server: {
      deps: {
        // Don't externalize these packages - needed for Workers APIs
        inline: ['agents', '@modelcontextprotocol/sdk', '@modelcontextprotocol/ext-apps'],
      },
    },
  },
  resolve: {
    alias: {
      // Mock binary/HTML imports that use Wrangler's build system
      // Use a JS file that exports empty strings
      '../site/brainstem_logo.png': new URL('./test-mocks/empty-asset.js', import.meta.url).pathname,
      '../site/brainstem-diagram.png': new URL('./test-mocks/empty-asset.js', import.meta.url).pathname,
      '../ui/dist/index.html': new URL('./test-mocks/empty-asset.js', import.meta.url).pathname,
      '../ui/dist/brain-explorer.html': new URL('./test-mocks/empty-asset.js', import.meta.url).pathname,
    },
  },
});
