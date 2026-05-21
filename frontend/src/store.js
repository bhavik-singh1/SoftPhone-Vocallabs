import { create } from "zustand";

// Call-status progression. Two sources update status: SIP.js (local, immediate)
// and the backend AMI feed (server truth, e.g. "ringing" on the trunk's
// 183/180). They can race, so status is only allowed to move FORWARD — this
// stops SIP.js's "dialing" from clobbering the backend's "ringing"/"answered".
const STATUS_RANK = {
  connecting: 0, dialing: 1, ringing: 2, answered: 3,
  ended: 4, "no-answer": 4, failed: 4,
};

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
    set((s) => {
      if (!s.currentCall) return {};
      const next = { ...s.currentCall, ...patch };
      // Never let status regress (forward-only progression).
      if (
        patch.status &&
        STATUS_RANK[patch.status] < STATUS_RANK[s.currentCall.status]
      ) {
        next.status = s.currentCall.status;
      }
      return { currentCall: next };
    }),
  endCall: () => set({ currentCall: null }),

  setHistory: (history) => set({ history }),
}));
