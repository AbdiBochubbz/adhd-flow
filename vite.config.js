import { defineConfig } from "vite";
import { cspPlugin, precachePlugin } from "./scripts/build-plugins.mjs";

export default defineConfig({
  base: "./",
  plugins: [cspPlugin(), precachePlugin()],
  build: {
    sourcemap: false,
    assetsDir: "assets",
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  server: { host: "0.0.0.0", port: 47321, strictPort: true },
  preview: { host: "0.0.0.0", port: 47321, strictPort: true },
});
