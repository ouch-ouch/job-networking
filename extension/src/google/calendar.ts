import type { Contact } from "../shared/types";
import { GoogleApiError, googleRequest } from "./auth";

const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
type CalendarEvent = {
  id: string;
  status?: string;
  hangoutLink?: string;
  conferenceData?: {
    createRequest?: { status?: { statusCode?: string } };
    entryPoints?: { entryPointType: string; uri: string }[];
  };
};
const meetLink = (event: CalendarEvent) =>
  event.hangoutLink ||
  event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video",
  )?.uri;

export function validateMeeting(start: string, end: string, email?: string) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("A valid contact email is required to invite them.");
  const isoWithZone =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
  const validDate = (value: string) => {
    if (!isoWithZone.test(value) || !Number.isFinite(Date.parse(value)))
      return false;
    const [year, month, day, hour, minute, second = 0] = value
      .match(/^([0-9]+)-([0-9]+)-([0-9]+)T([0-9]+):([0-9]+)(?::([0-9]+))?/)!
      .slice(1)
      .map((part) => Number(part || 0));
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day &&
      hour < 24 &&
      minute < 60 &&
      second < 60
    );
  };
  if (
    !validDate(start) ||
    !validDate(end) ||
    Date.parse(end) <= Date.parse(start)
  )
    throw new Error(
      "Choose a valid meeting start and end with a time zone. End must be after start.",
    );
}

export async function calendarEventIdFor(
  contactId: string,
  start: string,
  end: string,
): Promise<string> {
  const material = `${contactId}|${new Date(start).toISOString()}|${new Date(end).toISOString()}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material),
  );
  return (
    "ccc" +
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
  );
}

export async function createMeeting({
  contact,
  start,
  end,
  description = "",
}: {
  contact: Contact;
  start: string;
  end: string;
  description?: string;
}): Promise<{ id: string; meetLink?: string }> {
  validateMeeting(start, end, contact.email);
  const eventId = await calendarEventIdFor(contact.id, start, end);
  let event: CalendarEvent;
  try {
    event = await googleRequest<CalendarEvent>(
      `${base}?conferenceDataVersion=1&sendUpdates=all`,
      {
        method: "POST",
        body: JSON.stringify({
          id: eventId,
          summary: `Coffee chat with ${contact.name}`,
          description,
          start: { dateTime: start },
          end: { dateTime: end },
          attendees: [{ email: contact.email, displayName: contact.name }],
          conferenceData: {
            createRequest: {
              requestId: eventId,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }),
      },
    );
  } catch (error) {
    // A lost response must not create duplicate meetings or send another invitation.
    if (!(error instanceof GoogleApiError) || error.status !== 409) throw error;
    event = await googleRequest<CalendarEvent>(`${base}/${eventId}`);
    if (event.status === "cancelled")
      throw new Error(
        "This calendar time was previously cancelled. Choose another time or restore the event in Google Calendar.",
      );
  }
  if (!event.id)
    throw new Error(
      "Google Calendar did not confirm an event ID. Check your calendar before retrying.",
    );
  // Conference generation is asynchronous. Read the same event instead of creating another.
  for (
    let attempt = 0;
    attempt < 3 &&
    !meetLink(event) &&
    event.conferenceData?.createRequest?.status?.statusCode === "pending";
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      event = await googleRequest<CalendarEvent>(
        `${base}/${encodeURIComponent(event.id)}`,
      );
    } catch {
      break;
    }
  }
  return {
    id: event.id,
    ...(meetLink(event) ? { meetLink: meetLink(event) } : {}),
  };
}

export async function updateMeetingDescription(
  eventId: string,
  description: string,
): Promise<void> {
  if (!eventId || !description.trim())
    throw new Error("Calendar event and prep brief are required.");
  await googleRequest(
    `${base}/${encodeURIComponent(eventId)}?conferenceDataVersion=1&sendUpdates=none`,
    { method: "PATCH", body: JSON.stringify({ description }) },
  );
}
