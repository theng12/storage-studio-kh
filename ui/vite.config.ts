import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  base: "./",
  server: { port: 1420, strictPort: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "safari15",
  },
});
