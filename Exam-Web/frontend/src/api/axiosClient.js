import axios from "axios";

function resolveBaseUrl() {
  const envUrl = import.meta.env.VITE_API_URL?.trim();
  if (envUrl) {
    const cleaned = envUrl.replace(/\/+$/, "");
    return cleaned.endsWith("/api") ? cleaned : `${cleaned}/api`;
  }
  if (import.meta.env.PROD) {
    return "https://exam-web-ak0z.onrender.com/api";
  }
  return "http://localhost:5000/api";
}

const axiosClient = axios.create({
  baseURL: resolveBaseUrl(),
  headers: {
    "Content-Type": "application/json",
  },
});

axiosClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("ptit_exam_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("ptit_exam_token");
      sessionStorage.removeItem("ptit_exam_session");

      const currentPath = window.location.pathname;
      if (currentPath !== "/login" && currentPath !== "/register") {
        window.location.replace("/login");
      }
    }
    return Promise.reject(error);
  }
);

export default axiosClient;
