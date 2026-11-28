import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_COOKIE_NAME,
  getAuthCookieOptions,
  setAuthCookie,
  clearAuthCookie,
  createCsrfProtection,
  buildAllowedOriginsSet,
} from "../src/middlewares/authMiddleware.js";

function invokeMiddleware(middleware, reqOverrides = {}) {
  let nextCalled = false;
  let statusCode = 200;
  let jsonBody = null;

  const headers = Object.fromEntries(
    Object.entries(reqOverrides.headers || {}).map(([k, v]) => [
      k.toLowerCase(),
      v,
    ])
  );

  const req = {
    method: "POST",
    path: "/auth/login",
    originalUrl: "/api/auth/login",
    ...reqOverrides,
    headers,
    get(name) {
      return headers[String(name).toLowerCase()];
    },
  };

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      jsonBody = payload;
      return this;
    },
  };

  middleware(req, res, () => {
    nextCalled = true;
  });

  return { nextCalled, statusCode, jsonBody };
}

test("Cookie xác thực luôn dùng sameSite=lax, httpOnly=true và secure theo NODE_ENV", () => {
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    const prodOpts = getAuthCookieOptions();
    assert.equal(prodOpts.httpOnly, true);
    assert.equal(prodOpts.sameSite, "lax");
    assert.equal(prodOpts.secure, true);

    let setArgs = null;
    let clearArgs = null;
    const mockRes = {
      cookie: (...args) => {
        setArgs = args;
      },
      clearCookie: (...args) => {
        clearArgs = args;
      },
    };
    setAuthCookie(mockRes, "jwt_token");
    clearAuthCookie(mockRes);
    assert.equal(setArgs[0], AUTH_COOKIE_NAME);
    assert.equal(setArgs[2].sameSite, "lax");
    assert.equal(setArgs[2].secure, true);
    assert.equal(clearArgs[0], AUTH_COOKIE_NAME);
    assert.equal(clearArgs[1].sameSite, "lax");
    assert.equal(clearArgs[1].secure, true);
    assert.equal(clearArgs[1].httpOnly, true);

    process.env.NODE_ENV = "development";
    const devOpts = getAuthCookieOptions();
    assert.equal(devOpts.httpOnly, true);
    assert.equal(devOpts.sameSite, "lax");
    assert.equal(devOpts.secure, false);
  } finally {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  }
});

test("CSRF middleware chặn POST/PUT/PATCH/DELETE không hợp lệ (403) và cho phép X-Requested-With hoặc Origin tin cậy", () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;
  try {
    process.env.FRONTEND_URL = "https://ptit-exampro.vercel.app,https://exam.ptit.edu.vn";
    const csrf = createCsrfProtection(buildAllowedOriginsSet());

    // GET và OPTIONS luôn cho qua
    assert.equal(invokeMiddleware(csrf, { method: "GET" }).nextCalled, true);
    assert.equal(invokeMiddleware(csrf, { method: "OPTIONS" }).nextCalled, true);

    // Webhook được miễn trừ
    assert.equal(
      invokeMiddleware(csrf, {
        method: "POST",
        path: "/webhooks/payment",
        originalUrl: "/api/webhooks/payment",
      }).nextCalled,
      true
    );

    // POST/PUT/PATCH/DELETE thiếu cả X-Requested-With và Origin -> 403
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const blocked = invokeMiddleware(csrf, { method });
      assert.equal(blocked.nextCalled, false);
      assert.equal(blocked.statusCode, 403);
    }

    // Origin giả mạo hoặc null -> 403
    for (const badOrigin of [
      "https://evil-attacker.com",
      "http://localhost.evil.com",
      "null",
    ]) {
      const blocked = invokeMiddleware(csrf, {
        method: "POST",
        headers: { Origin: badOrigin },
      });
      assert.equal(blocked.nextCalled, false);
      assert.equal(blocked.statusCode, 403);
    }

    // Có X-Requested-With: XMLHttpRequest -> cho qua
    assert.equal(
      invokeMiddleware(csrf, {
        method: "POST",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      }).nextCalled,
      true
    );

    // Origin khớp FRONTEND_URL hoặc localhost -> cho qua
    for (const goodOrigin of [
      "https://ptit-exampro.vercel.app",
      "https://exam.ptit.edu.vn",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]) {
      const allowed = invokeMiddleware(csrf, {
        method: "DELETE",
        headers: { Origin: goodOrigin },
      });
      assert.equal(allowed.nextCalled, true, goodOrigin);
    }
  } finally {
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
  }
});
