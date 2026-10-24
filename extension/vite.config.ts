// Minimal config so the side panel runs in a normal browser tab against mock data
// (`npm run dev`, then open /src/sidepanel/index.html).
// D: add `crx({ manifest })` from @crxjs/vite-plugin here; nothing else needs to change.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { open: "/src/sidepanel/index.html" },
  build: {
    rollupOptions: { input: { sidepanel: "src/sidepanel/index.html" } },
  },
});
