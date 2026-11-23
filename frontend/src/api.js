// In production the backend is a separate Render service.
// Set VITE_API_URL to https://election-backend-z7bv.onrender.com in Render's
// frontend environment variables. In local dev it defaults to "" so the Vite
// proxy handles /api/* requests as before.
const API_BASE = import.meta.env.VITE_API_URL ?? "";

export async function apiRequest(path, { csrfToken, ...options } = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  if (response.status === 204) return null;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed");
  }
  return payload;
}
