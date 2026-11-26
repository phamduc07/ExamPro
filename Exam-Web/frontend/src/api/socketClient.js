import { io } from "socket.io-client";
import axiosClient from "./axiosClient";

export function resolveSocketUrl() {
  const apiBase = String(
    axiosClient.defaults.baseURL || "http://localhost:5000/api"
  ).replace(/\/+$/, "");
  return apiBase.endsWith("/api") ? apiBase.slice(0, -4) : apiBase;
}

export function createRealtimeSocket() {
  const socket = io(resolveSocketUrl(), {
    withCredentials: true,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  const handleSessionReplaced = (payload) => {
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
