import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  sendRegisterOtpEmail,
  sendAdminLoginOtpEmail,
  sendPasswordResetOtpEmail,
  verifyEmailExists,
} from "../utils/mailer.js";

export const OTP_EXPIRE_MINUTES = 5;
export const OTP_COOLDOWN_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 5;
export const DEMO_SUPER_ADMIN_OTP = "999999";

export function isDemoSuperAdminEmail(email) {
  const demoAdminEmail = (process.env.ADMIN_EMAIL || "admin@ptit.edu.vn")
    .trim()
    .toLowerCase();
  const normalized = String(email || "").trim().toLowerCase();
  return normalized === "admin@ptit.edu.vn" || normalized === demoAdminEmail;
}

export function generateNumericOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

export async function hashOtp(otp) {
  return bcrypt.hash(String(otp).trim(), 10);
}

export async function verifyOtpHash(otp, otpHash) {
  return bcrypt.compare(String(otp).trim(), otpHash);
}

export function signAdminOtpChallengeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      purpose: "ADMIN_LOGIN_OTP",
    },
    process.env.JWT_SECRET,
    { expiresIn: `${OTP_EXPIRE_MINUTES}m` }
  );
}

export function verifyAdminChallenge(challengeToken) {
  if (typeof challengeToken !== "string" || !challengeToken.trim()) {
    return null;
  }
  try {
    const decoded = jwt.verify(challengeToken.trim(), process.env.JWT_SECRET);
    if (decoded?.purpose !== "ADMIN_LOGIN_OTP" || !decoded?.id) return null;
    return decoded;
  } catch {
    return null;
  }
}

export {
  sendRegisterOtpEmail,
  sendAdminLoginOtpEmail,
  sendPasswordResetOtpEmail,
  verifyEmailExists,
};
