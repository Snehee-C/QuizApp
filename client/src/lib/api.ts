import { API_BASE } from "./config";

const TOKEN_KEY = "menti_token";
const USER_KEY = "menti_user";

export interface User {
  id: string;
  email: string;
  name: string;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setAuth(token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function getUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as User) : null;
}
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// --- Auth ---
export const api = {
  signup: (email: string, password: string, name: string) =>
    request<{ token: string; user: User }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    }),
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  // --- Presentations ---
  listPresentations: () => request<Presentation[]>("/presentations"),
  createPresentation: (title: string) =>
    request<Presentation>("/presentations", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  getPresentation: (id: string) =>
    request<PresentationWithSlides>(`/presentations/${id}`),
  updatePresentation: (id: string, title: string) =>
    request<Presentation>(`/presentations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  deletePresentation: (id: string) =>
    request<{ ok: boolean }>(`/presentations/${id}`, { method: "DELETE" }),

  // --- Slides ---
  addSlide: (presentationId: string, type: SlideType, question: string, config: any) =>
    request<Slide>(`/presentations/${presentationId}/slides`, {
      method: "POST",
      body: JSON.stringify({ type, question, config }),
    }),
  updateSlide: (
    presentationId: string,
    slideId: string,
    data: { question?: string; type?: SlideType; config?: any }
  ) =>
    request<Slide>(`/presentations/${presentationId}/slides/${slideId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteSlide: (presentationId: string, slideId: string) =>
    request<{ ok: boolean }>(
      `/presentations/${presentationId}/slides/${slideId}`,
      { method: "DELETE" }
    ),
  reorderSlides: (presentationId: string, order: string[]) =>
    request<{ ok: boolean }>(`/presentations/${presentationId}/slides/reorder`, {
      method: "POST",
      body: JSON.stringify({ order }),
    }),
};

// --- Types ---
export type SlideType = "MULTIPLE_CHOICE" | "WORD_CLOUD" | "SCALE" | "OPEN_ENDED";

export interface Presentation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  _count?: { slides: number };
}

export interface Slide {
  id: string;
  presentationId: string;
  order: number;
  type: SlideType;
  question: string;
  config: string; // JSON string from API
}

export interface PresentationWithSlides extends Presentation {
  slides: Slide[];
}

// Slides come back with config as a JSON string; parse helper:
export function parseConfig(slide: Slide): any {
  try {
    return JSON.parse(slide.config);
  } catch {
    return {};
  }
}
