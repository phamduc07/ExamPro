import { createContext, useContext, useState, useEffect } from "react";
import axiosClient from "../api/axiosClient";
import { useExamStore } from "../store/useExamStore";

const AuthContext = createContext(null);

function decodeValidJwtPayload(rawToken) {
  try {
    const parts = String(rawToken || "").split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = decodeURIComponent(
      Array.from(atob(padded))
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join("")
    );
    const payload = JSON.parse(json);
    if (!payload?.id || payload.purpose) return null;
    if (payload.exp && payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("ptit_exam_token");
    if (!token) {
      setLoading(false);
      return;
    }

    axiosClient
      .get("/auth/me")
      .then((res) => {
        setUser(res.data.data);
      })
      .catch((err) => {
        const status = err?.response?.status;
        if (status === 401 || status === 403 || status === 404) {
          localStorage.removeItem("ptit_exam_token");
          setUser(null);
          return;
        }
        const fallbackUser = decodeValidJwtPayload(token);
        if (fallbackUser) {
          setUser(fallbackUser);
        } else {
          localStorage.removeItem("ptit_exam_token");
          setUser(null);
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const login = async (email, password) => {
    const res = await axiosClient.post("/auth/login", { email, password });
    const data = res.data.data;
    if (data?.requiresOtp) {
      return {
        requiresOtp: true,
        email: data.email,
        challengeToken: data.challengeToken,
        cooldownSeconds: data.cooldownSeconds ?? 60,
        message: res.data.message,
      };
    }
    const { token, user: loggedUser } = data;
    localStorage.setItem("ptit_exam_token", token);
    setUser(loggedUser);
    return { requiresOtp: false, user: loggedUser };
  };

  const verifyAdminLoginOtp = async (challengeToken, otp) => {
    const res = await axiosClient.post("/auth/login/verify-otp", { challengeToken, otp });
    const data = res.data.data;
    if (data?.waitingSuperAdminApproval) {
      return {
        waitingSuperAdminApproval: true,
        userId: data.userId,
        email: data.email,
        approvalToken: data.approvalToken,
        message: res.data.message,
      };
    }
    if (data?.requiresPasswordChange) {
      return {
        requiresPasswordChange: true,
        challengeToken: data.challengeToken,
        email: data.email,
        message: res.data.message,
      };
    }
    const { token, user: loggedUser } = data;
    localStorage.setItem("ptit_exam_token", token);
    setUser(loggedUser);
    return { requiresPasswordChange: false, user: loggedUser };
  };

  const checkAdminApprovalStatus = async (approvalToken) => {
    const res = await axiosClient.post("/auth/login/check-approval", { approvalToken });
    const data = res.data.data || {};
    if (data.approved && data.token && data.user) {
      localStorage.setItem("ptit_exam_token", data.token);
      setUser(data.user);
    }
    return { ...data, message: res.data.message };
  };

  const forceChangePassword = async (challengeToken, newPassword) => {
    const res = await axiosClient.post("/auth/force-change-password", {
      challengeToken,
      newPassword,
    });
    const { token, user: loggedUser } = res.data.data;
    localStorage.setItem("ptit_exam_token", token);
    setUser(loggedUser);
    return loggedUser;
  };

  const resendAdminLoginOtp = async (challengeToken) => {
    const res = await axiosClient.post("/auth/login/resend-otp", { challengeToken });
    return res.data;
  };

  const sendRegisterOtp = async (payload) => {
    const res = await axiosClient.post("/auth/register/send-otp", payload);
    return res.data;
  };

  const register = async (payload) => {
    const res = await axiosClient.post("/auth/register", payload);
    return res.data;
  };

  const changePassword = async (currentPassword, newPassword) => {
    const res = await axiosClient.post("/auth/change-password", {
      currentPassword,
      newPassword,
    });
    return res.data;
  };

  const forgotPassword = async (email) => {
    const res = await axiosClient.post("/auth/forgot-password", { email });
    return res.data;
  };

  const resetPassword = async (email, otp, newPassword) => {
    const res = await axiosClient.post("/auth/reset-password", {
      email,
      otp,
      newPassword,
    });
    return res.data;
  };

  const logout = async () => {
    try {
      await axiosClient.post("/auth/logout");
    } catch {

    } finally {
      localStorage.removeItem("ptit_exam_token");
      useExamStore.getState().resetExamSession();
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: Boolean(user),
        login,
        verifyAdminLoginOtp,
        checkAdminApprovalStatus,
        forceChangePassword,
        resendAdminLoginOtp,
        sendRegisterOtp,
        register,
        changePassword,
        forgotPassword,
        resetPassword,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
