export const base = process.env.API_URL ?? 'http://localhost:8080';
export async function api(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json', ...options.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}
export const accounts = [
  { email: 'passenger1@demo.local', name: 'Passenger 1', role: 'PASSENGER', password: 'DemoPass123!' },
  { email: 'passenger2@demo.local', name: 'Passenger 2', role: 'PASSENGER', password: 'DemoPass123!' },
  { email: 'driver@demo.local', name: 'Driver', role: 'DRIVER', password: 'DemoPass123!' }
];
export async function login(index = 0) {
  const { email, password } = accounts[index];
  return api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}
