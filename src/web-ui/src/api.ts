export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export async function api<T>(path: string, token?: string, method = 'GET', body?: unknown, extraHeaders = {}): Promise<T> {
  const response = await fetch((import.meta.env.VITE_API_URL ?? 'http://localhost:8080') + path, {
    method, signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const value = await response.json();
  if (!response.ok) throw new ApiError(response.status, value.code ?? 'HTTP_ERROR', value.message ?? 'Yêu cầu thất bại');
  return value;
}
