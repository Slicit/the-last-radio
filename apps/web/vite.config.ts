import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    // For `npm run dev` against a running stack: point at the web container.
    proxy: {
      "/api": process.env.LASTRADIO_URL ?? "http://localhost:28700",
      "/hls": process.env.LASTRADIO_URL ?? "http://localhost:28700",
    },
  },
});
