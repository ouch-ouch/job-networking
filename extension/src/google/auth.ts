export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

const gmailBase = "https://gmail.googleapis.com/gmail/v1/users/me";

export async function getGoogleToken(interactive = false): Promise<string> {
  if (typeof chrome === "undefined" || !chrome.identity?.getAuthToken)
    throw new Error(
      "Google connection requires the loaded Chrome extension. Open the extension side panel in Chrome.",
    );
  const client = chrome.runtime.getManifest().oauth2?.client_id;
  if (!client || client.includes("YOUR_") || client.startsWith("replace"))
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_CLIENT_ID in .env, rebuild the extension, then reload it in Chrome. See backend/SETUP.md.",
    );
  const details: chrome.identity.TokenDetails & {
    enableGranularPermissions: boolean;
  } = { interactive, enableGranularPermissions: true };
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken(details, (token, grantedScopes) => {
      if (chrome.runtime.lastError) {
        reject(
          new Error(
            `Google connection failed: ${chrome.runtime.lastError.message}. Check the Chrome Extension OAuth client ID, matching extension ID, and Google test-user access.`,
          ),
        );
        return;
      }
      if (!token) {
        reject(
          new Error("Google is disconnected. Use Connect Google in Settings."),
        );
        return;
      }
      const required = chrome.runtime.getManifest().oauth2?.scopes || [];
      if (
        grantedScopes &&
        required.some((scope) => !grantedScopes.includes(scope))
      ) {
        reject(
          new Error(
            "Google permissions were only partially granted. Reconnect and allow Gmail send/read and Calendar events.",
          ),
        );
        return;
      }
      resolve(token);
    });
  });
}

export async function googleRequest<T>(
  url: string,
  options: RequestInit = {},
  retried = false,
): Promise<T> {
  const token = await getGoogleToken();
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
      signal: options.signal || AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(
      "Google could not be reached. A submitted action may still have completed. Check Gmail Sent or Calendar before retrying.",
    );
  }
  if (response.status === 401 && !retried) {
    await chrome.identity.removeCachedAuthToken({ token });
    return googleRequest<T>(url, options, true);
  }
  if (!response.ok) {
    const message =
      response.status === 401
        ? "Google authorization expired. Reconnect Google in Settings."
        : response.status === 403
          ? "Google denied access. Enable Gmail and Calendar APIs and grant all requested scopes. Your Workspace administrator may restrict access."
          : response.status === 429
            ? "Google rate limit reached. Try again later."
            : `Google API request failed (${response.status}). Try again before marking anything sent.`;
    throw new GoogleApiError(message, response.status);
  }
  return (await response.json()) as T;
}

export async function connectGoogle(): Promise<{ email: string }> {
  await getGoogleToken(true);
  const profile = await googleRequest<{ emailAddress: string }>(
    `${gmailBase}/profile`,
  );
  return { email: profile.emailAddress };
}
