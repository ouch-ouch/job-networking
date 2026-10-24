export default {
  manifest_version: 3,
  name: "networkMAX",
  version: "0.1.0",
  minimum_chrome_version: "116",
  permissions: ["sidePanel", "storage", "activeTab", "scripting"],
  action: { default_title: "Open networkMAX" },
  side_panel: { default_path: "src/sidepanel/index.html" },
  background: { service_worker: "src/background.ts", type: "module" },
  content_scripts: [
    {
      matches: [
        "https://www.linkedin.com/jobs/*",
        "https://boards.greenhouse.io/*",
        "https://job-boards.greenhouse.io/*",
        "https://jobs.lever.co/*",
      ],
      js: ["src/content/job-page.ts"],
    },
  ],
} satisfies chrome.runtime.ManifestV3;
