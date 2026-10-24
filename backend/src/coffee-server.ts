import "dotenv/config";
import { createApp } from "./app";

const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be an integer between 1 and 65535.");
const app = createApp({
  apiKey: process.env.XAI_API_KEY,
  draftModel: process.env.XAI_DRAFT_MODEL,
  classifyModel: process.env.XAI_CLASSIFY_MODEL,
  allowedExtensionIds: process.env.ALLOWED_EXTENSION_IDS?.split(",")
    .map((id) => id.trim())
    .filter(Boolean),
});
app.listen(port, "127.0.0.1", () => {
  console.log(`Coffee Chat Copilot backend: http://127.0.0.1:${port}`);
  console.log(
    process.env.XAI_API_KEY
      ? "Grok (xAI) key configured."
      : "Live AI requires XAI_API_KEY in .env. Demo mode works without it.",
  );
});
