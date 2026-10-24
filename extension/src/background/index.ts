import { executeAction } from "../shared/engine";
import { getState } from "../shared/storage";
import type { Action } from "../shared/types";

const ALARM_NAME = "coffee-chat-copilot-scheduler";
async function configureAlarm(): Promise<void> {
  const state = await getState();
  const periodInMinutes = state.settings.demoMode ? 1 : 15;
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing || existing.periodInMinutes !== periodInMinutes) {
    await chrome.alarms.create(ALARM_NAME, {
      periodInMinutes,
      delayInMinutes: periodInMinutes,
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void getState().then(configureAlarm).catch(console.error);
  chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  void configureAlarm().catch(console.error);
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME)
    void executeAction({ type: "RUN_SCHEDULER" }).catch(console.error);
});
chrome.runtime.onMessage.addListener(
  (message: { type?: string; action?: Action }, _sender, sendResponse) => {
    if (message.type !== "APP_ACTION" || !message.action) return false;
    void executeAction(message.action)
      .then(async (result) => {
        if (
          message.action?.type === "UPDATE_SETTINGS" ||
          message.action?.type === "RESET_DEMO"
        )
          await configureAlarm().catch(console.error);
        sendResponse({ ok: true, result });
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Action failed.",
        }),
      );
    return true;
  },
);
void configureAlarm().catch(console.error);
