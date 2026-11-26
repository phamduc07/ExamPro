import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";

export const AUTH_COOKIE_NAME = "ptit_access_token";
const AUTH_CACHE_TTL_MS = 2000;
const tokenVersionCache = new Map();

export function getAuthCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    path: "/",
    maxAge: 4 * 60 * 60 * 1000,
  };
}

export function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());
}

export function clearAuthCookie(res) {
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    path: "/",
  });
}

export function extractCookieValue(cookieHeader, targetName) {
  if (!cookieHeader || typeof cookieHeader !== "string") return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key === targetName) {
      const rawVal = part.slice(eqIdx + 1).trim();
      try {
        return decodeURIComponent(rawVal);
      } catch {
        return rawVal;
      }
    }
  }
  return null;
}

export function invalidateTokenVersionCache(userId) {
  if (userId !== undefined && userId !== null) {
    tokenVersionCache.delete(Number(userId));
  }
}

async function getCachedUserAuth(userId) {
  const key = Number(userId);
  const cached = tokenVersionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const [rows] = await pool.query(
    "SELECT id, full_name, student_code, major_group, email, role, is_super_admin, token_version, active_session_id FROM users WHERE id = ?",
    [key]
  );
  if (!rows.length) {
    tokenVersionCache.delete(key);
    return null;
  }
  const u = rows[0];
  const adminEmailEnv = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const isSuper =
    Number(u.is_super_admin) === 1 ||
    (adminEmailEnv && String(u.email || "").trim().toLowerCase() === adminEmailEnv)
      ? 1
      : 0;
  const entry = {
    version: Number(u.token_version ?? 1),
    active_session_id: u.active_session_id || null,
    is_super_admin: isSuper,
    role: u.role,
    email: u.email,
    full_name: u.full_name,
    student_code: u.student_code || null,
    major_group: u.major_group || null,
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
  };
  tokenVersionCache.set(key, entry);
  return entry;
}

export async function authenticateRawToken(token) {
  if (!token || typeof token !== "string") {
    return {
      ok: false,
      code: "MISSING_TOKEN",
      message: "Bạn chưa đăng nhập hoặc thiếu phiên xác thực (401 Unauthorized).",
    };
  }

  const secret = process.env.JWT_SECRET;
  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch {
    return {
      ok: false,
      code: "INVALID_TOKEN",
      message: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.",
    };
  }

  if (decoded.purpose) {
    return {
      ok: false,
      code: "TEMP_TOKEN",
      message: "Token xác thực tạm thời không có quyền truy cập tài nguyên này.",
    };
  }

  if (tokenVersionCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of tokenVersionCache.entries()) {
      if (v.expiresAt <= now) tokenVersionCache.delete(k);
    }
  }

  const authState = await getCachedUserAuth(decoded.id);
  if (!authState || Number(decoded.tokenVersion ?? 1) !== authState.version) {
    return {
      ok: false,
      code: "TOKEN_REVOKED",
      message: "Phiên đăng nhập đã bị thu hồi hoặc hết hiệu lực. Vui lòng đăng nhập lại.",
    };
  }

  const tokenSessionId = decoded.sessionId || decoded.session_id || null;
  if (
    !tokenSessionId ||
    !authState.active_session_id ||
    tokenSessionId !== authState.active_session_id
  ) {
    return {
      ok: false,
      code: "SESSION_REPLACED",
      message:
        "Tài khoản của bạn đã được đăng nhập ở thiết bị hoặc trình duyệt khác. Phiên hiện tại đã tự động đăng xuất.",
    };
  }

  return {
    ok: true,
    user: {
      ...decoded,
      id: Number(decoded.id),
      fullName: authState.full_name || decoded.fullName || "",
      studentCode: authState.student_code || decoded.studentCode || null,
      majorGroup: authState.major_group || decoded.majorGroup || null,
      email: authState.email || decoded.email,
      role: authState.role || decoded.role,
      is_super_admin: authState.is_super_admin,
      sessionId: tokenSessionId,
    },
  };
}

export async function verifyToken(req, res, next) {
  const cookieToken = extractCookieValue(req.headers.cookie, AUTH_COOKIE_NAME);
  const authHeader = req.headers.authorization;
  const bearerToken =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

  const token = cookieToken || bearerToken;
  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Bạn chưa đăng nhập hoặc thiếu phiên xác thực (401 Unauthorized).",
    });
  }

  const secret = process.env.JWT_SECRET;
  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch (jwtErr) {
    clearAuthCookie(res);
    if (
      jwtErr?.name === "JsonWebTokenError" ||
      jwtErr?.name === "TokenExpiredError" ||
      jwtErr?.name === "NotBeforeError"
    ) {
      return res.status(401).json({
        success: false,
        message: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.",
      });
    }
    return next(jwtErr);
  }

  if (decoded.purpose) {
    return res.status(401).json({
      success: false,
      message: "Token xác thực tạm thời không có quyền truy cập tài nguyên này.",
    });
  }

  try {
    if (tokenVersionCache.size > 500) {
      const now = Date.now();
      for (const [k, v] of tokenVersionCache.entries()) {
        if (v.expiresAt <= now) tokenVersionCache.delete(k);
      }
    }

    const authState = await getCachedUserAuth(decoded.id);
    if (
      !authState ||
      Number(decoded.tokenVersion ?? 1) !== authState.version
    ) {
      clearAuthCookie(res);
      return res.status(401).json({
        success: false,
        message: "Phiên đăng nhập đã bị thu hồi hoặc hết hiệu lực. Vui lòng đăng nhập lại.",
      });
    }

    const tokenSessionId = decoded.sessionId || decoded.session_id || null;
    if (
      !tokenSessionId ||
      !authState.active_session_id ||
      tokenSessionId !== authState.active_session_id
    ) {
      clearAuthCookie(res);
      return res.status(401).json({
        success: false,
        code: "SESSION_REPLACED",
        message:
          "Tài khoản của bạn đã được đăng nhập ở thiết bị hoặc trình duyệt khác. Phiên hiện tại đã tự động đăng xuất.",
      });
    }

    req.user = {
      ...decoded,
      email: authState.email || decoded.email,
      role: authState.role || decoded.role,
      is_super_admin: authState.is_super_admin,
      sessionId: tokenSessionId,
    };
    return next();
  } catch (dbError) {
    return next(dbError);
  }
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const userRole = req.user?.role;
    const isAdminAlias =
      allowedRoles.includes("TEACHER") &&
      ["TEACHER", "ADMIN", "SUPER_ADMIN"].includes(userRole);
    if (!req.user || (!allowedRoles.includes(userRole) && !isAdminAlias)) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền thực hiện thao tác này (403 Forbidden).",
      });
    }
    next();
  };
}

export function requireSuperAdmin(req, res, next) {
  const adminEmailEnv = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const isRootByEmail =
    Boolean(adminEmailEnv) &&
    String(req.user?.email || "").trim().toLowerCase() === adminEmailEnv;

  if (!req.user || (Number(req.user.is_super_admin) !== 1 && !isRootByEmail)) {
    return res.status(403).json({
      success: false,
      message: "Chỉ Super Admin mới có quyền thực hiện thao tác này (403 Forbidden).",
    });
  }
  next();
}
