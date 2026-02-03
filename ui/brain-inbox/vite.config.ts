import path from "path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [viteSingleFile()],
  root: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "../../ui/dist"),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
    },
  },
});
