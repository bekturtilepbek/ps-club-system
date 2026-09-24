import type { components } from "@/types/api";

export type SessionResponse = components["schemas"]["SessionResponse"];
export type HallSnapshotResponse = components["schemas"]["HallSnapshotResponse"];
export type HallConsoleResponse = components["schemas"]["HallConsoleResponse"];
export type BusinessDayResponse = components["schemas"]["BusinessDayResponse"];
export type BusinessDaySummaryResponse = components["schemas"]["BusinessDaySummaryResponse"];
export type PublicSettingsResponse = components["schemas"]["PublicSettingsResponse"];
export type AuthStatusResponse = components["schemas"]["AuthStatusResponse"];
export type TariffResponse = components["schemas"]["TariffResponse"];
export type SessionKind = components["schemas"]["SessionKind"];
export type PaymentMethod = components["schemas"]["PaymentMethod"];
export type ProductResponse = components["schemas"]["ProductResponse"];
export type OrderResponse = components["schemas"]["OrderResponse"];

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new ApiError(response.status, body.detail ?? response.statusText);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
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
  businessDayHistory: () => request<BusinessDayResponse[]>("/api/business-days?limit=30"),
  startSession: (body: {
    console_id: number;
    kind: SessionKind;
    tariff_id?: number | null;
    reason?: string | null;
  }) => request<SessionResponse>("/api/sessions", { method: "POST", body: JSON.stringify(body) }),
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
};
