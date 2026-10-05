import type { components } from "@/types/api";

export type SessionResponse = components["schemas"]["SessionResponse"];
export type HallSnapshotResponse = components["schemas"]["HallSnapshotResponse"];
export type HallConsoleResponse = components["schemas"]["HallConsoleResponse"];
export type BusinessDayResponse = components["schemas"]["BusinessDayResponse"];
export type BusinessDayHistoryItem = components["schemas"]["BusinessDayHistoryItem"];
export type FeedEventResponse = components["schemas"]["FeedEventResponse"];
export type FeedKind = components["schemas"]["FeedKind"];
export type BusinessDaySummaryResponse = components["schemas"]["BusinessDaySummaryResponse"];
export type PublicSettingsResponse = components["schemas"]["PublicSettingsResponse"];
export type AuthStatusResponse = components["schemas"]["AuthStatusResponse"];
export type TariffResponse = components["schemas"]["TariffResponse"];
export type SegmentResponse = components["schemas"]["SegmentResponse"];
export type SessionKind = components["schemas"]["SessionKind"];
export type PaymentMethod = components["schemas"]["PaymentMethod"];
export type ProductResponse = components["schemas"]["ProductResponse"];
export type OrderResponse = components["schemas"]["OrderResponse"];
export type GameResponse = components["schemas"]["GameResponse"];
export type AnalyticsSummaryResponse = components["schemas"]["AnalyticsSummaryResponse"];
export type PeriodTotalsResponse = components["schemas"]["PeriodTotalsResponse"];
export type AnalyticsRevenueResponse = components["schemas"]["AnalyticsRevenueResponse"];
export type AnalyticsLoadResponse = components["schemas"]["AnalyticsLoadResponse"];
export type LoadCellResponse = components["schemas"]["LoadCellResponse"];
export type AnalyticsBarResponse = components["schemas"]["AnalyticsBarResponse"];
export type AnalyticsGamesResponse = components["schemas"]["AnalyticsGamesResponse"];

/** The longest history the feed endpoint returns (core/api/routes/business_days.py). */
export const FEED_LIMIT = 500;

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** Called when the server says the login is no longer valid (the cookie expired, the secret changed). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  // A 401 from the login form itself just means a wrong password.
  if (response.status === 401 && path !== "/api/auth/login") notifyUnauthorized();
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new ApiError(response.status, body.detail ?? response.statusText);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

type AnalyticsRange = { from: string; to: string };

function analyticsQuery(range: AnalyticsRange, extra?: Record<string, string>): string {
  return new URLSearchParams({ from: range.from, to: range.to, ...extra }).toString();
}

export const api = {
  login: (password: string) =>
    request<AuthStatusResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => request<AuthStatusResponse>("/api/auth/logout", { method: "POST" }),
  me: () => request<AuthStatusResponse>("/api/auth/me"),
  settings: () => request<PublicSettingsResponse>("/api/settings"),
  tariffs: () => request<TariffResponse[]>("/api/tariffs"),
  hall: () => request<HallSnapshotResponse>("/api/hall"),
  currentBusinessDay: () => request<BusinessDayResponse>("/api/business-days/current"),
  openBusinessDay: (openingCash: number) =>
    request<BusinessDayResponse>("/api/business-days/open", {
      method: "POST",
      body: JSON.stringify({ opening_cash: openingCash }),
    }),
  closeBusinessDay: (businessDayId: number, countedCash: number) =>
    request<BusinessDayResponse>(`/api/business-days/${businessDayId}/close`, {
      method: "POST",
      body: JSON.stringify({ counted_cash: countedCash }),
    }),
  businessDaySummary: (businessDayId: number) =>
    request<BusinessDaySummaryResponse>(`/api/business-days/${businessDayId}/summary`),
  businessDayHistory: () => request<BusinessDayHistoryItem[]>("/api/business-days?limit=30"),
  businessDayFeed: (businessDayId: number) =>
    request<FeedEventResponse[]>(`/api/business-days/${businessDayId}/feed?limit=${FEED_LIMIT}`),
  startSession: (body: {
    console_id: number;
    kind: SessionKind;
    tariff_id?: number | null;
    reason?: string | null;
    game_id?: number | null;
  }) => request<SessionResponse>("/api/sessions", { method: "POST", body: JSON.stringify(body) }),
  games: () => request<GameResponse[]>("/api/games"),
  extendSession: (sessionId: number, tariffId: number) =>
    request<SessionResponse>(`/api/sessions/${sessionId}/extend`, {
      method: "POST",
      body: JSON.stringify({ tariff_id: tariffId }),
    }),
  stopSession: (sessionId: number) =>
    request<SessionResponse>(`/api/sessions/${sessionId}/stop`, { method: "POST" }),
  cancelSession: (sessionId: number) =>
    request<SessionResponse>(`/api/sessions/${sessionId}/cancel`, { method: "POST" }),
  paySession: (sessionId: number, amount: number, method: PaymentMethod) =>
    request(`/api/sessions/${sessionId}/payments`, {
      method: "POST",
      body: JSON.stringify({ amount, method }),
    }),
  products: () => request<ProductResponse[]>("/api/products"),
  addOrder: (sessionId: number, productId: number, qty: number) =>
    request<OrderResponse>(`/api/sessions/${sessionId}/orders`, {
      method: "POST",
      body: JSON.stringify({ product_id: productId, qty }),
    }),
  removeOrder: (orderId: number) => request(`/api/orders/${orderId}`, { method: "DELETE" }),
  openTicket: () => request<SessionResponse>("/api/tickets", { method: "POST" }),
  analyticsSummary: (range: AnalyticsRange) =>
    request<AnalyticsSummaryResponse>(`/api/analytics/summary?${analyticsQuery(range)}`),
  analyticsRevenue: (range: AnalyticsRange, group: "day" | "week" | "month") =>
    request<AnalyticsRevenueResponse>(`/api/analytics/revenue?${analyticsQuery(range, { group })}`),
  analyticsLoad: (range: AnalyticsRange) =>
    request<AnalyticsLoadResponse>(`/api/analytics/load?${analyticsQuery(range)}`),
  analyticsBar: (range: AnalyticsRange) =>
    request<AnalyticsBarResponse>(`/api/analytics/bar?${analyticsQuery(range)}`),
  analyticsGames: (range: AnalyticsRange) =>
    request<AnalyticsGamesResponse>(`/api/analytics/games?${analyticsQuery(range)}`),
};
