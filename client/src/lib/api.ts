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
  updatePresentation: (
    id: string,
    patch: Partial<
      Pick<Presentation, "title" | "theme" | "pacing" | "isTemplate" | "filterMode" | "timeScale">
    >
  ) =>
    request<Presentation>(`/presentations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  duplicatePresentation: (id: string, title?: string) =>
    request<Presentation>(`/presentations/${id}/duplicate`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  listTemplates: () => request<TemplateSummary[]>("/presentations/library/templates"),
  listSessions: (presentationId: string) =>
    request<SessionSummary[]>(`/presentations/${presentationId}/sessions`),
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
    data: { question?: string; type?: SlideType; config?: any; notes?: string }
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
// Slide types are open-ended by design: the set is owned by the slide registry
// (client/src/slides/registry.ts), and the server validates against its own
// registry. A closed union here would mean every new type had to edit this
// file too, which is exactly what the registry exists to avoid.
export type SlideType = string;

export interface Presentation {
  id: string;
  title: string;
  /** Stage palette key — resolved against lib/themes.ts. */
  theme: string;
  pacing: "PRESENTER" | "AUDIENCE";
  isTemplate: boolean;
  /** off | mask | block — filtering applied to participant-authored text. */
  filterMode: "off" | "mask" | "block";
  /** Countdown multiplier, 1–3. Relaxed timing for accessibility. */
  timeScale: number;
  createdAt: string;
  updatedAt: string;
  _count?: { slides: number };
}

export interface TemplateSummary extends Presentation {
  owner?: { name: string };
}

export interface SessionSummary {
  id: string;
  joinCode: string;
  status: "LOBBY" | "ACTIVE" | "ENDED";
  startedAt: string;
  endedAt: string | null;
  responses: number;
  questions: number;
  participants: number;
}

/**
 * Something the server's own slide module says is wrong with this config.
 *
 * The KIND is the whole of why this is usable in an editor. `broken` is a
 * contradiction — an answer key pointing past the end of the option list, a
 * quiz nobody can win — and no amount of further typing resolves it.
 * `incomplete` is a field that has not been filled in yet, which is what a
 * slide someone is halfway through writing looks like: measured, six of the
 * seventeen types are born with one the instant "+ Add slide" is pressed.
 * Treating the two alike is why this field went unread for a release.
 */
export interface SlideConfigIssue {
  kind: "broken" | "incomplete";
  message: string;
}

export interface Slide {
  id: string;
  presentationId: string;
  order: number;
  type: SlideType;
  question: string;
  config: string; // JSON string from API
  /** Speaker notes. Presenter-only — never sent to participants. */
  notes: string;
  /**
   * Present on every read of a deck and on every slide write. Optional
   * because a Slide also arrives from places that don't compute it.
   */
  configIssues?: SlideConfigIssue[];
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
