const CSRF_PROTECTED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const DEFAULT_FRONTEND_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://ptit-exampro.vercel.app",
];

export function normalizeOrigin(rawOrigin) {
  if (typeof rawOrigin !== "string" || !rawOrigin.trim()) return "";
  try {
    const parsed = new URL(rawOrigin.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.origin.toLowerCase();
  } catch {
    return "";
  }
}

export function buildAllowedOriginsSet(extraOrigins = []) {
  const envOrigins = (process.env.FRONTEND_URL || "")
    .split(",")
    .map((url) => normalizeOrigin(url))
    .filter(Boolean);

  const normalizedDefaults = DEFAULT_FRONTEND_ORIGINS.map((url) =>
    normalizeOrigin(url)
  ).filter(Boolean);

  const normalizedExtras = Array.from(extraOrigins || [])
    .map((url) => normalizeOrigin(url))
    .filter(Boolean);

  return new Set([...normalizedDefaults, ...envOrigins, ...normalizedExtras]);
}

export function isTrustedFrontendOrigin(rawOrigin, allowedOriginsSet = null) {
  const normalized = normalizeOrigin(rawOrigin);
  if (!normalized) return false;

  try {
    const { hostname } = new URL(normalized);
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return true;
    }
  } catch {
    return false;
  }

  const origins = allowedOriginsSet || buildAllowedOriginsSet();
  return origins.has(normalized);
}

function isWebhookRoute(req) {
  const requestPath = String(req.path || "").toLowerCase();
  const originalUrl = String(req.originalUrl || "").split("?")[0].toLowerCase();
  return (
    requestPath === "/webhook" ||
    requestPath.startsWith("/webhook/") ||
    requestPath === "/webhooks" ||
    requestPath.startsWith("/webhooks/") ||
    originalUrl === "/api/webhook" ||
    originalUrl.startsWith("/api/webhook/") ||
    originalUrl === "/api/webhooks" ||
    originalUrl.startsWith("/api/webhooks/")
  );
}

export function createCsrfProtection(allowedOriginsSet = null) {
  return function csrfProtection(req, res, next) {
    const method = String(req.method || "").toUpperCase();
    if (!CSRF_PROTECTED_METHODS.has(method)) {
      return next();
    }

    if (isWebhookRoute(req)) {
      return next();
    }

    const rawXRequestedWith =
      typeof req.get === "function"
        ? req.get("X-Requested-With")
        : req.headers?.["x-requested-with"];
    const hasValidXRequestedWith =
      typeof rawXRequestedWith === "string" &&
      rawXRequestedWith.trim().toLowerCase() === "xmlhttprequest";

    const rawOrigin =
      typeof req.get === "function"
        ? req.get("Origin")
        : req.headers?.origin;
    const hasTrustedOrigin =
      typeof rawOrigin === "string" &&
      isTrustedFrontendOrigin(rawOrigin, allowedOriginsSet);

    if (hasValidXRequestedWith || hasTrustedOrigin) {
      return next();
    }

    return res.status(403).json({
      success: false,
      code: "CSRF_FORBIDDEN",
      message:
        "Yêu cầu bị từ chối để bảo vệ chống giả mạo yêu cầu liên trang (403 Forbidden).",
    });
  };
}

export const csrfProtection = createCsrfProtection();
