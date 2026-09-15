import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    // In dev, the Vite app talks to `wrangler dev` (port 8787) for API + share routes.
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/raw": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
});
