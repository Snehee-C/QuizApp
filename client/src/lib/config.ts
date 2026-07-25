// Base URL for the backend.
// - Local dev: uses the same hostname the browser is on, port 3000.
//   So localhost -> localhost:3000, and a phone at 192.168.x.x -> 192.168.x.x:3000.
// - Production: set VITE_API_URL at build time (e.g. https://api.yourdomain.com).
export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  `http://${window.location.hostname}:3000`;
