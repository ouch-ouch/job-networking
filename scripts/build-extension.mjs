import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { config } from "dotenv";
config();
const oauthClientId = process.env.GOOGLE_CLIENT_ID || "";
const manifest = {
  manifest_version: 3,
  name: "Coffee Chat Copilot",
  description:
    "Turn a job opportunity into a thoughtful conversation. Every message needs your approval.",
  version: "0.1.0",
  minimum_chrome_version: "116",
  permissions: [
    "sidePanel",
    "storage",
    "alarms",
    "identity",
    "activeTab",
    "scripting",
  ],
  host_permissions: [
    "https://www.googleapis.com/*",
    "https://gmail.googleapis.com/*",
    "https://www.linkedin.com/*",
    "http://localhost/*",
    "http://127.0.0.1/*",
  ],
  side_panel: { default_path: "index.html" },
  action: { default_title: "Open Coffee Chat Copilot" },
  background: { service_worker: "background.js", type: "module" },
  content_scripts: [
    {
      matches: [
        "https://www.linkedin.com/search/results/people/*",
        "https://www.linkedin.com/in/*",
        "https://boards.greenhouse.io/*",
        "https://job-boards.greenhouse.io/*",
        "https://jobs.lever.co/*",
        "https://www.linkedin.com/jobs/*",
      ],
      js: ["content.js"],
    },
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
  ...(oauthClientId
    ? {
        oauth2: {
          client_id: oauthClientId,
          scopes: [
            "https://www.googleapis.com/auth/gmail.send",
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/calendar.events",
          ],
        },
      }
    : {}),
  ...(process.env.EXTENSION_PUBLIC_KEY
    ? { key: process.env.EXTENSION_PUBLIC_KEY }
    : {}),
};
await writeFile("dist/manifest.json", JSON.stringify(manifest, null, 2));
await build({
  entryPoints: ["extension/src/background/index.ts"],
  outfile: "dist/background.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome116",
  sourcemap: true,
});
await build({
  entryPoints: ["extension/src/content/content-script.ts"],
  outfile: "dist/content.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome116",
  sourcemap: true,
});
console.log(
  `Extension ready in dist/. Google OAuth: ${oauthClientId ? "configured" : "not configured (demo mode ready)"}`,
);
