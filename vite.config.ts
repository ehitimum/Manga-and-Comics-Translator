import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// Vite builds the React options page directly into extension/options/.
// The Chrome extension's manifest.json points options_page to "options/index.html".

export default defineConfig({
  // Use relative paths so the built options page loads correctly
  // when the browser opens chrome-extension://[id]/options/index.html
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'extension/options',
    emptyOutDir: true,
    // Inline small assets so we don't need the assets/ folder in the extension
    assetsInlineLimit: 1024 * 1024,
    rollupOptions: {
      output: {
        // Stable filenames for easier debugging in the loaded extension
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
});
