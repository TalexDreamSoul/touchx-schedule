import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const adminBase = process.env.ADMIN_BASE?.trim() || "/admin/";
const outputDir = process.env.ADMIN_OUT_DIR?.trim()
  ? resolve(__dirname, process.env.ADMIN_OUT_DIR)
  : resolve(__dirname, "dist");

export default defineConfig({
  plugins: [vue()],
  base: adminBase,
  build: {
    outDir: outputDir,
    emptyOutDir: true,
  },
  server: {
    port: 5188,
    host: "0.0.0.0",
  },
});
