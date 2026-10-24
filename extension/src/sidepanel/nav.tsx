import { createContext, useContext } from "react";

export type Tab = "setup" | "targets" | "queue" | "questions" | "activity" | "pipeline";

export type Nav = {
  tab: Tab;
  go: (tab: Tab) => void;
  /** Jump to a contact's card on the Targets screen (opened). */
  openContact: (contactId: string) => void;
  focusedContactId: string | null;
};

export const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error("useNav outside NavContext");
  return n;
}
