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
        // CE closes an active editor on scroll. Focusing an edge cell's input
        // must not trigger another browser scroll that immediately closes it.
        const editorFocus = "i.focus(),i.value=s";
        if (!code.includes(editorFocus))
          throw new Error(
            "Review the Jspreadsheet cell-focus adapter after upgrading CE.",
          );
        const scrollClose =
          't.edition&&"jdropdown"!=e.target.className.substr(0,9)&&closeEditor.call(t,t.edition[0],!0)';
        if (!code.includes(scrollClose))
          throw new Error(
            "Review the Jspreadsheet text-editor scroll adapter after upgrading CE.",
          );
        return {
          code: code
            .replace(handler, "")
            .replace(editorFocus, "i.focus({preventScroll:true}),i.value=s")
            .replace(
              scrollClose,
              't.edition&&!t.edition[0].querySelector("input,textarea")&&"jdropdown"!=e.target.className.substr(0,9)&&closeEditor.call(t,t.edition[0],!0)',
            ),
          map: null,
        };
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
