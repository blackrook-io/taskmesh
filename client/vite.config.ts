import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Yellow favicon only while `vite` is serving; production builds keep green. */
function devInstanceFavicon(): Plugin {
  return {
    name: "taskmesh-dev-favicon",
    transformIndexHtml(html, ctx) {
      if (!ctx.server) return html;
      return html.replace('href="/favicon.svg"', 'href="/favicon-dev.svg"');
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  /** Dev API port — keep separate from PROD Express on :3000 (nginx → :80). */
  const apiPort = env.DEV_API_PORT || process.env.DEV_API_PORT || "3001";

  return {
    plugins: [react(), devInstanceFavicon()],
    optimizeDeps: {
      include: ["@excalidraw/excalidraw"],
    },
    define: {
      "process.env.IS_PREACT": JSON.stringify("false"),
    },
    server: {
      host: true, // 0.0.0.0 — LAN hosts can reach :5173
      port: 5173,
      strictPort: true,
      // Same-origin `/api` proxy — do not inject CORS. Vite's default allows
      // localhost/127.0.0.1 with ACAO but without Allow-Credentials, which can
      // prevent the browser from storing the session cookie after login while
      // LAN hosts (no ACAO) keep working.
      cors: false,
      // Agent/editor writes sometimes skip inotify; polling keeps HMR honest.
      watch: { usePolling: true, interval: 400 },
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          // Keep browser Host (e.g. :5173) so CSRF same-origin checks match Origin/Referer.
          changeOrigin: false,
        },
      },
    },
  };
});
