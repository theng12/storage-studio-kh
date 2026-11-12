import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  server: { port: 1420, strictPort: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "safari15",
  },
});
