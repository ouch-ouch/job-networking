import { useCallback, useEffect, useRef, useState } from "react";
import type { Action, ActionResult, AppState } from "./types";
import { getState, subscribe } from "./storage";
import { executeAction } from "./engine";

export function useStore() {
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const refresh = () => {
      getState()
        .then((next) => {
          if (alive.current) {
            setState(next);
            setLoading(false);
          }
        })
        .catch((reason) => {
          if (alive.current) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Could not load saved data.",
            );
            setLoading(false);
          }
        });
    };
    refresh();
    const unsubscribe = subscribe(refresh);
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, []);
  const dispatch = useCallback(
    async (action: Action): Promise<ActionResult> => {
      setError(null);
      try {
        let result: ActionResult;
        if (typeof chrome !== "undefined" && chrome.runtime?.id) {
          const response = (await chrome.runtime.sendMessage({
            type: "APP_ACTION",
            action,
          })) as { ok: boolean; result?: ActionResult; error?: string };
          if (!response?.ok || !response.result)
            throw new Error(
              response?.error ||
                "The extension background did not respond. Reload the extension.",
            );
          result = response.result;
        } else result = await executeAction(action);
        if (alive.current) setState(result.state);
        return result;
      } catch (reason) {
        const message =
          reason instanceof Error
            ? reason.message
            : "Something went wrong. Please try again.";
        if (alive.current) setError(message);
        throw new Error(message);
      }
    },
    [],
  );
  const clearError = useCallback(() => setError(null), []);
  return { state, loading, dispatch, error, clearError };
}
