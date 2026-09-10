export type InstagramHealth = {
  service: string;
  writes_enabled: boolean;
  dry_run: boolean;
};

export type PendingAction = {
  id: string;
  principal: string;
  action: string;
  target: string;
  payload: string | Record<string, unknown>;
  created_at: number | string;
  expires_at: number | string;
};

export type InstagramOverview = {
  state: "connected" | "not_configured" | "unavailable";
  connected: boolean;
  health: InstagramHealth;
  pending: PendingAction[];
  pending_available: boolean;
};

export type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { message?: string } | string;
};

export class InstagramApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
