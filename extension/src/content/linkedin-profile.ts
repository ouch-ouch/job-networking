import type { Contact, Draft } from "../shared/types";
import { canonicalLinkedInProfile } from "./sourcing";

function visible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return (
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    element.getClientRects().length > 0
  );
}

/** Fills an existing composer only. The user opens the profile, opens the box, and clicks Send. */
export function fillLinkedInComposer(
  contact: Contact,
  draft: Draft,
  root: Document = document,
): void {
  if (draft.status !== "approved")
    throw new Error("Approve this draft before filling LinkedIn.");
  if (draft.contactId !== contact.id)
    throw new Error("This draft belongs to a different contact.");
  if (draft.channel === "email")
    throw new Error("Choose a LinkedIn draft to fill a LinkedIn composer.");
  if (!draft.body.trim()) throw new Error("The draft is empty.");
  if (draft.channel === "linkedin_connect" && draft.body.length > 300)
    throw new Error("Connection notes must be 300 characters or fewer.");
  const expected =
    contact.linkedinUrl && canonicalLinkedInProfile(contact.linkedinUrl);
  if (
    !expected ||
    canonicalLinkedInProfile(window.location.href) !== expected
  ) {
    throw new Error(
      `Open ${contact.name}'s LinkedIn profile in the active tab before filling the note.`,
    );
  }
  const selectors =
    draft.channel === "linkedin_connect"
      ? [
          "textarea#custom-message",
          '[role="dialog"] textarea[name="message"]',
          '.artdeco-modal textarea[aria-label*="message" i]',
        ]
      : [
          '.msg-form__contenteditable[contenteditable="true"]',
          '[role="dialog"] [contenteditable="true"][role="textbox"][aria-label*="message" i]',
          '[role="dialog"] textarea[name="message"]',
        ];
  const candidates = selectors
    .flatMap((selector) =>
      Array.from(root.querySelectorAll<HTMLElement>(selector)),
    )
    .filter(
      (element) =>
        visible(element) &&
        !element.hasAttribute("disabled") &&
        !element.hasAttribute("readonly"),
    );
  const composer = [...new Set(candidates)].find((element) => {
    if (draft.channel === "linkedin_connect") return true;
    const container = element.closest(
      '.msg-overlay-conversation-bubble, .msg-conversation-card, [role="dialog"]',
    );
    if (!container) return false;
    const recipientLinks = [
      ...container.querySelectorAll<HTMLAnchorElement>(
        '.msg-overlay-bubble-header a[href*="/in/"], .msg-thread__link-to-profile, .msg-conversation-card__participant-names a[href*="/in/"]',
      ),
    ];
    if (recipientLinks.length)
      return recipientLinks.some(
        (link) => canonicalLinkedInProfile(link.href) === expected,
      );
    const heading = container.querySelector(
      '.msg-overlay-bubble-header__title, .msg-entity-lockup__entity-title, .msg-conversation-card__participant-names, h2, [role="heading"]',
    );
    const recipient = heading?.textContent
      ?.replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return Boolean(
      recipient && recipient.includes(contact.name.trim().toLowerCase()),
    );
  });
  if (!composer)
    throw new Error(
      `Open ${draft.channel === "linkedin_connect" ? "Connect → Add a note" : "a message box addressed to this contact"} on LinkedIn first, then try again. You can also copy the draft manually.`,
    );
  const current =
    composer instanceof HTMLTextAreaElement ||
    composer instanceof HTMLInputElement
      ? composer.value
      : composer.textContent || "";
  if (current.trim() && current.trim() !== draft.body.trim())
    throw new Error(
      "The LinkedIn message box already contains text. Clear it first or paste the approved draft manually.",
    );
  if (current.trim() === draft.body.trim()) return;
  composer.focus();
  if (
    composer instanceof HTMLTextAreaElement ||
    composer instanceof HTMLInputElement
  ) {
    const prototype =
      composer instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(composer, draft.body);
    else composer.value = draft.body;
  } else composer.textContent = draft.body;
  composer.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: draft.body,
    }),
  );
  composer.dispatchEvent(new Event("change", { bubbles: true }));
}
