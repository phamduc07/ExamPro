import { io } from "socket.io-client";

const RENDER_BACKEND_ORIGIN = "https://ptit-exampro-backend.onrender.com";
const LOCAL_BACKEND_ORIGIN = "http://localhost:5000";

let socketAuthToken = null;

export function setSocketAuthToken(token) {
  socketAuthToken =
    typeof token === "string" && token.trim() ? token.trim() : null;
}

export function resolveSocketUrl() {
  const envUrl = import.meta.env.VITE_API_URL?.trim();
  if (envUrl && /^https?:\/\//i.test(envUrl)) {
    const cleaned = envUrl.replace(/\/+$/, "");
    return cleaned.endsWith("/api") ? cleaned.slice(0, -4) : cleaned;
  }
  if (import.meta.env.PROD) {
    return RENDER_BACKEND_ORIGIN;
  }
  return LOCAL_BACKEND_ORIGIN;
}

export function createRealtimeSocket() {
  const socket = io(resolveSocketUrl(), {
    withCredentials: true,
    auth: (cb) => {
      cb(socketAuthToken ? { token: socketAuthToken } : {});
    },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  const handleSessionReplaced = (payload) => {
    setSocketAuthToken(null);
    try {
      sessionStorage.removeItem("ptit_exam_session");
      if (payload?.message) {
        sessionStorage.setItem("ptit_auth_kick_notice", payload.message);
      }
    } catch {}
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    if (window.location.pathname !== "/login") {
      window.location.replace("/login");
    }
  };

  socket.on("auth:session_replaced", handleSessionReplaced);
  socket.on("connect_error", (err) => {
    if (err?.data?.code === "SESSION_REPLACED") {
      handleSessionReplaced({ message: err.message });
    }
  });

  return socket;
}
