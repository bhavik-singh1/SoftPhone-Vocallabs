import { create } from "zustand";

// UI state. The SipPhone instance itself lives in a ref in App (not in state).
export const useStore = create((set) => ({
  registered: false,
  // currentCall: { number, status, answeredAt, muted } | null
  currentCall: null,
  history: [],
  error: null,

  setRegistered: (registered) => set({ registered }),
  setError: (error) => set({ error }),

  startCall: (number) =>
    set({
      currentCall: { number, status: "connecting", answeredAt: null, muted: false },
    }),
  updateCall: (patch) =>
    set((s) => (s.currentCall ? { currentCall: { ...s.currentCall, ...patch } } : {})),
  endCall: () => set({ currentCall: null }),

  setHistory: (history) => set({ history }),
}));
