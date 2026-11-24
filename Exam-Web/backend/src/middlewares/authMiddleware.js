import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";

const TOKEN_VERSION_TTL_MS = 60 * 1000;
const tokenVersionCache = new Map();

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
    "SELECT id, email, role, is_super_admin, token_version FROM users WHERE id = ?",
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
    is_super_admin: isSuper,
    role: u.role,
    email: u.email,
    expiresAt: Date.now() + TOKEN_VERSION_TTL_MS,
  };
  tokenVersionCache.set(key, entry);
  return entry;
}

export async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc thiếu Token xác thực (401 Unauthorized).",
      });
    }

    const token = authHeader.split(" ")[1];
    const secret = process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret);
    if (decoded.purpose) {
      return res.status(401).json({
        success: false,
        message: "Token xác thực tạm thời không có quyền truy cập tài nguyên này.",
      });
    }

    const authState = await getCachedUserAuth(decoded.id);
    if (
      !authState ||
      Number(decoded.tokenVersion ?? 1) !== authState.version
    ) {
      return res.status(401).json({
        success: false,
        message: "Phiên đăng nhập đã bị thu hồi hoặc hết hiệu lực. Vui lòng đăng nhập lại.",
      });
    }

    req.user = {
      ...decoded,
      email: authState.email || decoded.email,
      role: authState.role || decoded.role,
      is_super_admin: authState.is_super_admin,
    };
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.",
    });
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
