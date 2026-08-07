import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  /** Dev API port — keep separate from PROD Express on :3000 (nginx → :80). */
  const apiPort = env.DEV_API_PORT || process.env.DEV_API_PORT || "3001";

  return {
    plugins: [react()],
    optimizeDeps: {
      include: ["@excalidraw/excalidraw"],
    },
    define: {
      "process.env.IS_PREACT": JSON.stringify("false"),
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
