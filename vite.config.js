import copy from "rollup-plugin-copy";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: "src/main.js",
      output: {
        entryFileNames: "scripts/main.js",
        format: "es",
      },
    },
  },
  plugins: [
    copy({
      targets: [
        { src: "src/module.json", dest: "dist" },
        { src: "src/styles", dest: "dist" },
        { src: "src/templates", dest: "dist" },
      ],
      hook: "writeBundle",
    }),
  ],
});
