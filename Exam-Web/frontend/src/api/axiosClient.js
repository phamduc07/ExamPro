import axios from "axios";

function resolveBaseUrl() {
  const envUrl = import.meta.env.VITE_API_URL?.trim();
  if (envUrl) {
    const cleaned = envUrl.replace(/\/+$/, "");
    return cleaned.endsWith("/api") ? cleaned : `${cleaned}/api`;
  }
  if (import.meta.env.PROD) {
    return "https://ptit-exampro-backend.onrender.com/api";
  }
  return "http://localhost:5000/api";
}

const axiosClient = axios.create({
  baseURL: resolveBaseUrl(),
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const reqUrl = String(error.config?.url || "");
      const isInitialMeCheck = reqUrl.includes("/auth/me");
      const isAuthFlow =
        reqUrl.includes("/auth/login") ||
        reqUrl.includes("/auth/register") ||
        reqUrl.includes("/auth/force-change-password");
      const errCode = error.response?.data?.code;
      const errMsg = error.response?.data?.message;

      try {
        localStorage.removeItem("ptit_exam_token");
        if (!isAuthFlow) {
          sessionStorage.removeItem("ptit_exam_session");
        }
        if (errCode === "SESSION_REPLACED" && errMsg) {
          sessionStorage.setItem("ptit_auth_kick_notice", errMsg);
        }
      } catch {}

      const currentPath = window.location.pathname;
      if (
        currentPath !== "/login" &&
        currentPath !== "/register" &&
        (!isInitialMeCheck || errCode === "SESSION_REPLACED") &&
        !isAuthFlow
      ) {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
        window.location.replace("/login");
      }
    }
    return Promise.reject(error);
  }
);

export default axiosClient;
