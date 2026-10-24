import { build, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import manifest from "./manifest.config";

// Bundle Chrome's script entries separately: content scripts cannot be ES modules.
function extensionBuild(): Plugin {
  return {
    name: "networkmax-extension",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify({
          ...manifest,
          background: { ...manifest.background, service_worker: "background.js" },
          content_scripts: manifest.content_scripts.map((script) => ({
            ...script, js: ["content/job-page.js"],
          })),
        }, null, 2),
      });
    },
    async closeBundle() {
      for (const [entry, fileName] of [
        [manifest.background.service_worker, "background.js"],
        [manifest.content_scripts[0].js[0], "content/job-page.js"],
      ]) {
        await build({
          configFile: false,
          publicDir: false,
          build: {
            emptyOutDir: false,
            lib: { entry, name: "NetworkMaxScript", formats: ["iife"], fileName: () => fileName },
          },
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), extensionBuild()],
  server: { open: "/src/sidepanel/index.html" },
  build: {
    rollupOptions: { input: { sidepanel: manifest.side_panel.default_path } },
  },
});
