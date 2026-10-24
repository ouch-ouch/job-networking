import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  // Root .env: the extension needs the shared BACKEND_TOKEN for the /v1 X-research routes.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    root: ".",
    base: "./",
    build: { outDir: "dist", emptyOutDir: true },
    server: { port: 5173 },
    define: { __BACKEND_TOKEN__: JSON.stringify(env.BACKEND_TOKEN || "") },
  };
});
