import { createContext, useContext } from "react";

export type AuthModalMode = "login" | "register";

type AuthUIContextValue = {
  authed: boolean;
  openAuth: (mode?: AuthModalMode) => void;
  closeAuth: () => void;
  setAuthed: (value: boolean) => void;
};

const AuthUIContext = createContext<AuthUIContextValue | null>(null);

export const AuthUIProvider = AuthUIContext.Provider;

export const useAuthUI = (): AuthUIContextValue => {
  const ctx = useContext(AuthUIContext);
  if (!ctx) {
    throw new Error("useAuthUI must be used inside AuthUIProvider");
  }
  return ctx;
};

