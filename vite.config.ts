import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ["@tauri-apps/api/webview"] },
  server: {
    watch: {
      ignored: [
        "**/.tools/**",
        "**/design/validation/**",
        "**/src-tauri/target/**",
        "**/src-tauri/resources/**",
      ],
    },
    port: 1420,
    strictPort: true,
    proxy: {
      "/host": {
        target: "http://127.0.0.1:1421",
        rewrite: (path) => path.replace(/^\/host/, ""),
        headers: {
          Authorization: `Bearer ${process.env.ISLET_DEV_TOKEN || ""}`,
        },
      },
    },
  },
  clearScreen: false,
});
