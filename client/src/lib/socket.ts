import { io, type Socket } from "socket.io-client";
import { API_BASE } from "./config";
import { avatarIndexFor } from "./avatars";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE, { autoConnect: true });
  }
  return socket;
}

// crypto.randomUUID() only exists in "secure contexts" (HTTPS or localhost).
// Phones joining over plain http://<lan-ip> are NOT a secure context, so that
// API is undefined there — fall back to a manual v4-ish generator that works
// everywhere.
function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// A stable anonymous ID for a participant, persisted in localStorage
// so refreshing the page keeps their identity (and their one vote per slide).
export function getParticipantId(): string {
  const KEY = "menti_participant_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(KEY, id);
  }
  return id;
}

// The secret that proves this phone holds its seat in a room (server: "Seat
// secrets" in sockets/session.ts). Minted HERE, beside the id, and sent on
// every join — the server stores the hash of whatever the claiming join
// presented. Minting it on the server instead left a window: a phone emits its
// join twice before the first ack lands (a reconnect mid-join; StrictMode in
// dev), the first claims the seat, and the second — still holding no secret —
// is refused its own seat.
//
// One per device, like the id it belongs to: a different hash row per session,
// and it never leaves this phone except to the server. `getRandomValues`, not
// `randomUUID`, because it exists outside secure contexts (see `randomId`).
const SEAT_SECRET_KEY = "menti_seat_secret";
let seatSecretInMemory: string | null = null;

function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getSeatSecret(): string {
  if (seatSecretInMemory) return seatSecretInMemory;
  let secret: string | null = null;
  try {
    secret = localStorage.getItem(SEAT_SECRET_KEY);
  } catch {
    /* fall through to a fresh one */
  }
  if (!secret) secret = setSeatSecret(randomSecret());
  seatSecretInMemory = secret;
  return secret;
}

function setSeatSecret(secret: string): string {
  // Memory first: a phone whose storage refuses the write must still survive
  // a Wi-Fi blip, and every reconnect re-joins.
  seatSecretInMemory = secret;
  try {
    localStorage.setItem(SEAT_SECRET_KEY, secret);
  } catch {
    /* this page keeps the seat; a reload starts over (see below) */
  }
  return secret;
}

/**
 * Abandon this device's id and secret and mint new ones. Only for a seat the
 * server refuses as belonging to another device (`SEAT_TAKEN`) — in practice a
 * phone that kept its id but lost its secret. The id is worthless without it,
 * so the phone starts over as a new player rather than sitting on an error no
 * reload can get past.
 */
export function resetParticipantId(): string {
  const id = randomId();
  try {
    localStorage.setItem("menti_participant_id", id);
  } catch {
    /* the new id still works for this page's life */
  }
  setSeatSecret(randomSecret());
  return id;
}

// The participant's preset avatar index, derived deterministically from their
// stable participant ID so it stays the same across renders and reloads.
export function getAvatarIndex(): number {
  return avatarIndexFor(getParticipantId());
}

const NICKNAME_KEY = "menti_nickname";
export function getNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) || "";
}
export function setNickname(name: string) {
  localStorage.setItem(NICKNAME_KEY, name);
}
