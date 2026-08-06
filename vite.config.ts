import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "test" ? [] : [cloudflare()])],
  build: {
    outDir: "dist/client",
  },
  server: {
    watch: { ignored: ["**/.wrangler/**"] },
  },
}));
