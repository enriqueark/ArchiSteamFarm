import { createContext, createElement, type ReactNode, useContext, useMemo } from "react";

export type AuthModalMode = "login" | "register";

type AuthUIState = {
  authed: boolean;
  openAuth: (mode?: AuthModalMode) => void;
  closeAuth: () => void;
  setAuthed: (value: boolean) => void;
};

const noop = () => {};
const noopSet = (_value: boolean) => {};

const defaultValue: AuthUIState = {
  authed: false,
  openAuth: noop,
  closeAuth: noop,
  setAuthed: noopSet
};

const AuthUIContext = createContext<AuthUIState>(defaultValue);

export function AuthUIProvider({
  value,
  children
}: {
  value: AuthUIState;
  children: ReactNode;
}) {
  return createElement(AuthUIContext.Provider, { value }, children);
}

export function useAuthUI(): AuthUIState {
  const contextValue = useContext(AuthUIContext);
  return useMemo(() => contextValue, [contextValue]);
}
