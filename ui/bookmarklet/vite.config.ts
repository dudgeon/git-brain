import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "../dist"),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "src/clip.ts"),
      formats: ["iife"],
      name: "BrainClip",
      fileName: () => "bookmarklet.js",
    },
    minify: "esbuild",
  },
});
