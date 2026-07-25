import { io, type Socket } from "socket.io-client";
import { API_BASE } from "./config";

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

const NICKNAME_KEY = "menti_nickname";
export function getNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) || "";
}
export function setNickname(name: string) {
  localStorage.setItem(NICKNAME_KEY, name);
}
