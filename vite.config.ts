import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "islet-offline-grid-csp",
      transform(code, id) {
        if (
          !id.replaceAll("\\", "/").endsWith("/jspreadsheet-ce/dist/index.js")
        )
          return;
        // CE 5.0.4's inline selection handler conflicts with the native CSP.
        // Selection prevention is supplied by our wrapper and CSS instead.
        const handler =
          ',e.corner.setAttribute("onselectstart","return false")';
        if (!code.includes(handler))
          throw new Error(
            "Review the Jspreadsheet CSP adapter after upgrading CE.",
          );
        return { code: code.replace(handler, ""), map: null };
      },
    },
  ],
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
