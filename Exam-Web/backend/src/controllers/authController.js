import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import { isText } from "../utils/validation.js";
import { invalidateTokenVersionCache } from "../middlewares/authMiddleware.js";
import {
  sendRegisterOtpEmail,
  sendAdminLoginOtpEmail,
  sendPasswordResetOtpEmail,
  verifyEmailExists,
} from "../utils/mailer.js";
import {
  parsePtitEmail,
  KY_THUAT_MAJORS,
  KINH_TE_MAJORS,
} from "../utils/ptitHelper.js";

const OTP_EXPIRE_MINUTES = 5;
const OTP_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const ACCOUNT_LOCK_MINUTES = 15;

function validateStrongPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    return "Mật khẩu phải có tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và chữ số.";
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    return "Mật khẩu phải có tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và chữ số.";
  }
  return "";
}

function validateRegisterFields({ fullName, email, password }) {
  if (!isText(fullName, 120) || !isText(email, 150) || typeof password !== "string") {
    return { error: "Vui lòng nhập đầy đủ họ tên, email và mật khẩu.", parsed: null };
  }
  const parsed = parsePtitEmail(email);
  if (!parsed.isValid) {
    return { error: parsed.error, parsed: null };
  }
  const passError = validateStrongPassword(password);
  if (passError) {
    return { error: passError, parsed: null };
  }
  return { error: "", parsed };
}

function formatUserPayload(user) {
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    studentCode: user.student_code,
    studentId: user.student_code,
    majorGroup: user.major_group || null,
    is_super_admin: Number(user.is_super_admin) === 1 ? 1 : 0,
    must_change_password: Number(user.must_change_password) === 1 ? 1 : 0,
    tokenVersion: Number(user.token_version ?? 1),
  };
}

function signForceChangePasswordToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      purpose: "FORCE_CHANGE_PASSWORD",
    },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

function generateStrongTempPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const chars = [
    upper[crypto.randomInt(upper.length)],
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    digits[crypto.randomInt(digits.length)],
  ];
  while (chars.length < 12) {
    chars.push(all[crypto.randomInt(all.length)]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function signUserToken(user) {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN || "4h";
  return jwt.sign(formatUserPayload(user), secret, { expiresIn });
}

export async function sendRegisterOtp(req, res, next) {
  try {
    const { fullName, email, password } = req.body;
    const { error: validationError, parsed } = validateRegisterFields({ fullName, email, password });
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const [existing] = await pool.query(
      "SELECT email, student_code FROM users WHERE email = ? OR student_code = ?",
      [normalizedEmail, parsed.studentId]
    );
    if (existing.length > 0) {
      const isEmailDup = existing.some((row) => row.email.toLowerCase() === normalizedEmail);
      return res.status(409).json({
        success: false,
        message: isEmailDup
          ? "Email này đã được sử dụng."
          : `Mã sinh viên ${parsed.studentId} đã được đăng ký trong hệ thống.`,
      });
    }

    const emailExists = await verifyEmailExists(normalizedEmail);
    if (!emailExists) {
      return res.status(400).json({
        success: false,
        message: "Email không tồn tại.",
      });
    }

    const [otpRows] = await pool.query(
      "SELECT TIMESTAMPDIFF(SECOND, last_sent_at, NOW()) AS elapsed FROM email_otps WHERE email = ?",
      [normalizedEmail]
    );
    if (otpRows.length > 0 && otpRows[0].elapsed !== null && otpRows[0].elapsed < OTP_COOLDOWN_SECONDS) {
      const retryAfter = OTP_COOLDOWN_SECONDS - Number(otpRows[0].elapsed);
      return res.status(429).json({
        success: false,
        message: `Vui lòng chờ ${retryAfter} giây trước khi gửi lại mã OTP.`,
        data: { retryAfter },
      });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = await bcrypt.hash(otp, 10);

    await sendRegisterOtpEmail({
      to: normalizedEmail,
      fullName: fullName.trim(),
      otp,
      expiresMinutes: OTP_EXPIRE_MINUTES,
    });

    await pool.query(
      `INSERT INTO email_otps (email, otp_hash, expires_at, attempts, last_sent_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 0, NOW())
       ON DUPLICATE KEY UPDATE
         otp_hash = VALUES(otp_hash),
         expires_at = VALUES(expires_at),
         attempts = 0,
         last_sent_at = NOW()`,
      [normalizedEmail, otpHash, OTP_EXPIRE_MINUTES]
    );

    return res.status(200).json({
      success: true,
      message: "Mã OTP gồm 6 chữ số đã được gửi tới email của bạn. Vui lòng kiểm tra hộp thư (kể cả mục Spam).",
      data: {
        email: normalizedEmail,
        studentId: parsed.studentId,
        majorCode: parsed.majorCode,
        majorName: parsed.majorName,
        majorGroup: parsed.majorGroup,
        expiresInSeconds: OTP_EXPIRE_MINUTES * 60,
        cooldownSeconds: OTP_COOLDOWN_SECONDS,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function register(req, res, next) {
  try {
    const { fullName, email, password, otp } = req.body;

    const { error: validationError, parsed } = validateRegisterFields({ fullName, email, password });
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    if (typeof otp !== "string" || !/^\d{6}$/.test(otp.trim())) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập đủ mã OTP gồm 6 chữ số đã được gửi về email.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const [existing] = await pool.query(
      "SELECT email, student_code FROM users WHERE email = ? OR student_code = ?",
      [normalizedEmail, parsed.studentId]
    );
    if (existing.length > 0) {
      const isEmailDup = existing.some((row) => row.email.toLowerCase() === normalizedEmail);
      return res.status(409).json({
        success: false,
        message: isEmailDup
          ? "Email này đã được sử dụng."
          : `Mã sinh viên ${parsed.studentId} đã được đăng ký trong hệ thống.`,
      });
    }

    const emailExists = await verifyEmailExists(normalizedEmail);
    if (!emailExists) {
      return res.status(400).json({
        success: false,
        message: "Email không tồn tại.",
      });
    }

    const [otpRows] = await pool.query(
      "SELECT id, otp_hash, attempts, (expires_at < NOW()) AS is_expired FROM email_otps WHERE email = ?",
      [normalizedEmail]
    );
    if (otpRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Bạn chưa yêu cầu mã OTP hoặc mã đã hết hạn. Vui lòng gửi lại mã OTP.",
      });
    }

    const otpRow = otpRows[0];
    if (otpRow.is_expired) {
      await pool.query("DELETE FROM email_otps WHERE id = ?", [otpRow.id]);
      return res.status(400).json({
        success: false,
        message: "Mã OTP đã hết hạn (quá 5 phút). Vui lòng gửi lại mã OTP mới.",
      });
    }

    if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
      await pool.query("DELETE FROM email_otps WHERE id = ?", [otpRow.id]);
      return res.status(429).json({
        success: false,
        message: "Bạn đã nhập sai OTP quá nhiều lần. Vui lòng gửi lại mã OTP mới.",
      });
    }

    const isOtpValid = await bcrypt.compare(otp.trim(), otpRow.otp_hash);
    if (!isOtpValid) {
      const nextAttempts = otpRow.attempts + 1;
      if (nextAttempts >= OTP_MAX_ATTEMPTS) {
        await pool.query("DELETE FROM email_otps WHERE id = ?", [otpRow.id]);
        return res.status(429).json({
          success: false,
          message: "Mã OTP không đúng và đã bị hủy do nhập sai quá 5 lần. Vui lòng gửi lại mã OTP mới.",
        });
      }
      await pool.query("UPDATE email_otps SET attempts = ? WHERE id = ?", [nextAttempts, otpRow.id]);
      return res.status(400).json({
        success: false,
        message: `Mã OTP không chính xác. Bạn còn ${OTP_MAX_ATTEMPTS - nextAttempts} lần thử.`,
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const validRole = "STUDENT";

    const [result] = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role, student_code, major_group)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [fullName.trim(), normalizedEmail, passwordHash, validRole, parsed.studentId, parsed.majorGroup]
    );

    await pool.query("DELETE FROM email_otps WHERE email = ?", [normalizedEmail]);

    const newUser = {
      id: result.insertId,
      full_name: fullName.trim(),
      email: normalizedEmail,
      role: validRole,
      student_code: parsed.studentId,
      major_group: parsed.majorGroup,
    };

    const token = signUserToken(newUser);

    return res.status(201).json({
      success: true,
      message: "Xác thực email và đăng ký tài khoản thành công!",
      data: {
        token,
        user: formatUserPayload(newUser),
      },
    });
  } catch (error) {
    next(error);
  }
}

function signAdminOtpChallengeToken(user) {
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

function verifyAdminChallenge(challengeToken) {
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

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!isText(email, 150) || typeof password !== "string" || !password) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập đầy đủ email và mật khẩu.",
      });
    }

    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [
      email.trim().toLowerCase(),
    ]);
    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Email hoặc mật khẩu không chính xác.",
      });
    }

    const user = rows[0];
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remainingMins = Math.max(
        1,
        Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000)
      );
      return res.status(429).json({
        success: false,
        message: `Tài khoản đang tạm khóa do nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau ${remainingMins} phút.`,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      const nextFailed = (Number(user.failed_login_attempts) || 0) + 1;
      if (nextFailed >= MAX_FAILED_LOGIN_ATTEMPTS) {
        await pool.query(
          "UPDATE users SET failed_login_attempts = ?, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?",
          [nextFailed, ACCOUNT_LOCK_MINUTES, user.id]
        );
        return res.status(429).json({
          success: false,
          message: `Bạn đã nhập sai mật khẩu quá ${MAX_FAILED_LOGIN_ATTEMPTS} lần liên tiếp. Tài khoản tạm khóa ${ACCOUNT_LOCK_MINUTES} phút.`,
        });
      }
      await pool.query(
        "UPDATE users SET failed_login_attempts = ? WHERE id = ?",
        [nextFailed, user.id]
      );
      return res.status(401).json({
        success: false,
        message: `Email hoặc mật khẩu không chính xác (còn ${
          MAX_FAILED_LOGIN_ATTEMPTS - nextFailed
        } lần thử).`,
      });
    }

    if (Number(user.failed_login_attempts) > 0 || user.locked_until) {
      await pool.query(
        "UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?",
        [user.id]
      );
    }

    const isAdminAccount =
      ["TEACHER", "ADMIN", "SUPER_ADMIN"].includes(user.role) ||
      Number(user.is_super_admin) === 1;

    if (isAdminAccount) {
      const challengeToken = signAdminOtpChallengeToken(user);
      const [otpRows] = await pool.query(
        `SELECT id, (expires_at < NOW()) AS is_expired,
                TIMESTAMPDIFF(SECOND, last_sent_at, NOW()) AS elapsed
         FROM login_otps WHERE user_id = ?`,
        [user.id]
      );

      if (
        otpRows.length > 0 &&
        !otpRows[0].is_expired &&
        otpRows[0].elapsed !== null &&
        Number(otpRows[0].elapsed) < OTP_COOLDOWN_SECONDS
      ) {
        const remainingCooldown = OTP_COOLDOWN_SECONDS - Number(otpRows[0].elapsed);
        return res.status(200).json({
          success: true,
          message: "Mã OTP đăng nhập Admin đã được gửi tới email của bạn và vẫn còn hiệu lực. Vui lòng nhập mã để tiếp tục.",
          data: {
            requiresOtp: true,
            requires2fa: true,
            email: user.email,
            challengeToken,
            expiresInSeconds: OTP_EXPIRE_MINUTES * 60,
            cooldownSeconds: remainingCooldown,
          },
        });
      }

      const otp = String(crypto.randomInt(100000, 1000000));
      const otpHash = await bcrypt.hash(otp, 10);

      await sendAdminLoginOtpEmail({
        to: user.email,
        fullName: user.full_name,
        otp,
        expiresMinutes: OTP_EXPIRE_MINUTES,
      });

      await pool.query(
        `INSERT INTO login_otps (user_id, email, otp_hash, expires_at, attempts, last_sent_at)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 0, NOW())
         ON DUPLICATE KEY UPDATE
           email = VALUES(email),
           otp_hash = VALUES(otp_hash),
           expires_at = VALUES(expires_at),
           attempts = 0,
           last_sent_at = NOW()`,
        [user.id, user.email, otpHash, OTP_EXPIRE_MINUTES]
      );

      return res.status(200).json({
        success: true,
        message: "Đã gửi mã OTP xác thực đăng nhập Admin tới email của bạn. Vui lòng kiểm tra hộp thư (kể cả mục Spam).",
        data: {
          requiresOtp: true,
          requires2fa: true,
          email: user.email,
          challengeToken,
          expiresInSeconds: OTP_EXPIRE_MINUTES * 60,
          cooldownSeconds: OTP_COOLDOWN_SECONDS,
        },
      });
    }

    const token = signUserToken(user);

    return res.status(200).json({
      success: true,
      message: "Đăng nhập thành công!",
      data: {
        token,
        user: formatUserPayload(user),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function verifyAdminLoginOtp(req, res, next) {
  try {
    const { challengeToken, otp } = req.body;
    const challenge = verifyAdminChallenge(challengeToken);
    if (!challenge) {
      return res.status(401).json({
        success: false,
        message: "Phiên xác thực OTP đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.",
      });
    }

    if (typeof otp !== "string" || !/^\d{6}$/.test(otp.trim())) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập đủ mã OTP gồm 6 chữ số.",
      });
    }

    const [otpRows] = await pool.query(
      "SELECT id, otp_hash, attempts, (expires_at < NOW()) AS is_expired FROM login_otps WHERE user_id = ?",
      [challenge.id]
    );
    if (otpRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Mã OTP không tồn tại hoặc đã được sử dụng. Vui lòng yêu cầu gửi lại mã.",
      });
    }

    const otpRow = otpRows[0];
    if (otpRow.is_expired) {
      await pool.query("DELETE FROM login_otps WHERE id = ?", [otpRow.id]);
      return res.status(400).json({
        success: false,
        message: "Mã OTP đã hết hạn (quá 5 phút). Vui lòng gửi lại mã mới.",
      });
    }

    if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
      await pool.query("DELETE FROM login_otps WHERE id = ?", [otpRow.id]);
      return res.status(429).json({
        success: false,
        message: "Bạn đã nhập sai OTP quá nhiều lần. Vui lòng đăng nhập lại để nhận mã mới.",
      });
    }

    const isOtpValid = await bcrypt.compare(otp.trim(), otpRow.otp_hash);
    if (!isOtpValid) {
      const nextAttempts = otpRow.attempts + 1;
      if (nextAttempts >= OTP_MAX_ATTEMPTS) {
        await pool.query("DELETE FROM login_otps WHERE id = ?", [otpRow.id]);
        return res.status(429).json({
          success: false,
          message: "Mã OTP không đúng và đã bị hủy do nhập sai quá 5 lần. Vui lòng đăng nhập lại.",
        });
      }
      await pool.query("UPDATE login_otps SET attempts = ? WHERE id = ?", [nextAttempts, otpRow.id]);
      return res.status(400).json({
        success: false,
        message: `Mã OTP không chính xác. Bạn còn ${OTP_MAX_ATTEMPTS - nextAttempts} lần thử.`,
      });
    }

    const [userRows] = await pool.query(
      "SELECT * FROM users WHERE id = ? AND (role IN ('TEACHER', 'ADMIN', 'SUPER_ADMIN') OR is_super_admin = 1)",
      [challenge.id]
    );
    if (userRows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Tài khoản không có quyền Quản trị viên.",
      });
    }

    const user = userRows[0];
    await pool.query("DELETE FROM login_otps WHERE user_id = ?", [user.id]);

    if (Number(user.must_change_password) === 1) {
      return res.status(200).json({
        success: true,
        message: "Tài khoản Admin mới bắt buộc đổi mật khẩu cá nhân trước khi sử dụng.",
        data: {
          requiresPasswordChange: true,
          mustChangePassword: true,
          email: user.email,
          challengeToken: signForceChangePasswordToken(user),
        },
      });
    }

    const token = signUserToken(user);
    return res.status(200).json({
      success: true,
      message: "Xác thực OTP thành công! Chào mừng Quản trị viên.",
      data: {
        token,
        user: formatUserPayload(user),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function resendAdminLoginOtp(req, res, next) {
  try {
    const { challengeToken } = req.body;
    const challenge = verifyAdminChallenge(challengeToken);
    if (!challenge) {
      return res.status(401).json({
        success: false,
        message: "Phiên xác thực đã hết hạn. Vui lòng đăng nhập lại.",
      });
    }

    const [userRows] = await pool.query(
      "SELECT * FROM users WHERE id = ? AND (role IN ('TEACHER', 'ADMIN', 'SUPER_ADMIN') OR is_super_admin = 1)",
      [challenge.id]
    );
    if (userRows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Tài khoản không có quyền Quản trị viên.",
      });
    }

    const user = userRows[0];
    const [otpRows] = await pool.query(
      "SELECT TIMESTAMPDIFF(SECOND, last_sent_at, NOW()) AS elapsed FROM login_otps WHERE user_id = ?",
      [user.id]
    );
    if (otpRows.length > 0 && otpRows[0].elapsed !== null && Number(otpRows[0].elapsed) < OTP_COOLDOWN_SECONDS) {
      const retryAfter = OTP_COOLDOWN_SECONDS - Number(otpRows[0].elapsed);
      return res.status(429).json({
        success: false,
        message: `Vui lòng chờ ${retryAfter} giây trước khi gửi lại mã OTP.`,
        data: { retryAfter },
      });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = await bcrypt.hash(otp, 10);

    await sendAdminLoginOtpEmail({
      to: user.email,
      fullName: user.full_name,
      otp,
      expiresMinutes: OTP_EXPIRE_MINUTES,
    });

    await pool.query(
      `INSERT INTO login_otps (user_id, email, otp_hash, expires_at, attempts, last_sent_at)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 0, NOW())
       ON DUPLICATE KEY UPDATE
         email = VALUES(email),
         otp_hash = VALUES(otp_hash),
         expires_at = VALUES(expires_at),
         attempts = 0,
         last_sent_at = NOW()`,
      [user.id, user.email, otpHash, OTP_EXPIRE_MINUTES]
    );

    return res.status(200).json({
      success: true,
      message: "Đã gửi lại mã OTP mới tới Gmail của bạn.",
      data: {
        email: user.email,
        challengeToken: signAdminOtpChallengeToken(user),
        expiresInSeconds: OTP_EXPIRE_MINUTES * 60,
        cooldownSeconds: OTP_COOLDOWN_SECONDS,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getMe(req, res, next) {
  try {
    const [rows] = await pool.query(
      "SELECT id, full_name, email, role, student_code, major_group, is_super_admin, must_change_password, token_version, created_at FROM users WHERE id = ?",
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy người dùng.",
      });
    }

    const u = rows[0];
    return res.status(200).json({
      success: true,
      data: {
        ...formatUserPayload(u),
        createdAt: u.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function logout(req, res, next) {
  try {
    await pool.query(
      "UPDATE users SET token_version = token_version + 1 WHERE id = ?",
      [req.user.id]
    );
    invalidateTokenVersionCache(req.user.id);
    return res.status(200).json({
      success: true,
      message: "Đăng xuất và thu hồi phiên đăng nhập thành công!",
    });
  } catch (error) {
    next(error);
  }
}

export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== "string" || !currentPassword) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập mật khẩu hiện tại.",
      });
    }
    const passError = validateStrongPassword(newPassword);
    if (passError) {
      return res.status(400).json({ success: false, message: passError });
    }

    const [rows] = await pool.query("SELECT id, password_hash FROM users WHERE id = ?", [
      req.user.id,
    ]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Không tìm thấy người dùng." });
    }

    const isMatch = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Mật khẩu hiện tại không chính xác.",
      });
    }

    const nextHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",
      [nextHash, req.user.id]
    );
    invalidateTokenVersionCache(req.user.id);

    return res.status(200).json({
      success: true,
      message: "Đổi mật khẩu thành công! Vui lòng đăng nhập lại bằng mật khẩu mới.",
    });
  } catch (error) {
    next(error);
  }
}

export async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    if (!isText(email, 150)) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập địa chỉ email.",
      });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const [rows] = await pool.query(
      "SELECT id, full_name, email FROM users WHERE email = ?",
      [normalizedEmail]
    );
    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy tài khoản nào gắn với email này.",
      });
    }

    const [recentRows] = await pool.query(
      `SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS elapsed
       FROM password_resets
       WHERE email = ?
       ORDER BY id DESC
       LIMIT 1`,
      [normalizedEmail]
    );
    if (
      recentRows.length > 0 &&
      recentRows[0].elapsed !== null &&
      Number(recentRows[0].elapsed) < OTP_COOLDOWN_SECONDS
    ) {
      return res.status(429).json({
        success: false,
        message: "Vui lòng đợi 60 giây trước khi yêu cầu gửi lại mã OTP.",
      });
    }

    const user = rows[0];
    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = await bcrypt.hash(otp, 10);

    await sendPasswordResetOtpEmail({
      to: user.email,
      fullName: user.full_name,
      otp,
      expiresMinutes: OTP_EXPIRE_MINUTES,
    });

    await pool.query(
      `INSERT INTO password_resets (email, otp_code, expires_at, failed_attempts, used)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 0, 0)`,
      [user.email, otpHash, OTP_EXPIRE_MINUTES]
    );

    return res.status(200).json({
      success: true,
      message: "Mã OTP 6 chữ số đặt lại mật khẩu đã được gửi về email của bạn.",
    });
  } catch (error) {
    next(error);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const { email, otp, newPassword } = req.body;
    if (!isText(email, 150) || typeof otp !== "string" || !/^\d{6}$/.test(otp.trim())) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập email và đủ mã OTP 6 chữ số.",
      });
    }
    const passError = validateStrongPassword(newPassword);
    if (passError) {
      return res.status(400).json({ success: false, message: passError });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const [resetRows] = await pool.query(
      `SELECT id, otp_code, failed_attempts, (expires_at < NOW()) AS is_expired
       FROM password_resets
       WHERE email = ? AND used = 0
       ORDER BY id DESC
       LIMIT 1`,
      [normalizedEmail]
    );

    if (!resetRows.length) {
      return res.status(400).json({
        success: false,
        message: "Mã OTP không tồn tại hoặc đã được sử dụng.",
      });
    }
    if (resetRows[0].is_expired) {
      await pool.query("UPDATE password_resets SET used = 1 WHERE id = ?", [resetRows[0].id]);
      return res.status(400).json({
        success: false,
        message: "Mã OTP đã hết hạn. Vui lòng yêu cầu mã mới.",
      });
    }

    const isValid = await bcrypt.compare(otp.trim(), resetRows[0].otp_code);
    if (!isValid) {
      const nextFailed = (Number(resetRows[0].failed_attempts) || 0) + 1;
      if (nextFailed >= OTP_MAX_ATTEMPTS) {
        await pool.query(
          "UPDATE password_resets SET failed_attempts = ?, used = 1 WHERE id = ?",
          [nextFailed, resetRows[0].id]
        );
        return res.status(400).json({
          success: false,
          message: "Bạn đã nhập sai OTP quá 5 lần. Vui lòng yêu cầu gửi lại mã mới.",
        });
      }
      await pool.query(
        "UPDATE password_resets SET failed_attempts = ? WHERE id = ?",
        [nextFailed, resetRows[0].id]
      );
      return res.status(400).json({
        success: false,
        message: `Mã OTP không chính xác (còn ${OTP_MAX_ATTEMPTS - nextFailed} lần thử).`,
      });
    }

    const [userRows] = await pool.query("SELECT id FROM users WHERE email = ?", [
      normalizedEmail,
    ]);
    const nextHash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE password_resets SET used = 1 WHERE email = ?", [normalizedEmail]);
    await pool.query(
      `UPDATE users
       SET password_hash = ?, token_version = token_version + 1,
           failed_login_attempts = 0, locked_until = NULL
       WHERE email = ?`,
      [nextHash, normalizedEmail]
    );
    if (userRows.length > 0) {
      invalidateTokenVersionCache(userRows[0].id);
    }

    return res.status(200).json({
      success: true,
      message: "Đặt lại mật khẩu thành công! Bạn có thể đăng nhập bằng mật khẩu mới.",
    });
  } catch (error) {
    next(error);
  }
}

function inferMajorGroupFromStudent(row) {
  if (row.major_group) return row.major_group;
  const code = String(row.student_code || "").trim().toUpperCase();
  const m = code.match(/^[BN]\d{2}DC([A-Z]{2})\d{3}$/);
  if (m) {
    const majorCode = m[1];
    if (Object.prototype.hasOwnProperty.call(KY_THUAT_MAJORS, majorCode)) return "KY_THUAT";
    if (Object.prototype.hasOwnProperty.call(KINH_TE_MAJORS, majorCode)) return "KINH_TE";
  }
  const parsed = parsePtitEmail(row.email || "");
  return parsed.isValid ? parsed.majorGroup : null;
}

export async function getStudentsForAdmin(req, res, next) {
  try {
    const [rows] = await pool.query(`
      SELECT
        u.id,
        u.full_name,
        u.email,
        u.student_code,
        u.major_group,
        u.failed_login_attempts,
        u.locked_until,
        u.created_at,
        (u.locked_until IS NOT NULL AND u.locked_until > NOW()) AS is_locked,
        (SELECT COUNT(*) FROM submissions sub WHERE sub.student_id = u.id) AS submission_count
      FROM users u
      WHERE u.role = 'STUDENT' AND COALESCE(u.is_super_admin, 0) = 0
      ORDER BY is_locked DESC, u.id DESC
    `);

    const formatted = rows.map((row) => ({
      ...row,
      major_group: inferMajorGroupFromStudent(row),
    }));

    return res.status(200).json({
      success: true,
      data: formatted,
    });
  } catch (error) {
    next(error);
  }
}

export async function unlockUser(req, res, next) {
  try {
    const rawIdentifier =
      req.body?.email || req.body?.student_code || req.body?.identifier || "";
    const identifier = String(rawIdentifier).trim();
    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập Email hoặc Mã sinh viên cần mở khóa.",
      });
    }

    const [rows] = await pool.query(
      `SELECT id, full_name, email, student_code
       FROM users
       WHERE LOWER(email) = LOWER(?) OR UPPER(student_code) = UPPER(?)
       LIMIT 1`,
      [identifier, identifier]
    );
    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy tài khoản khớp với Email hoặc Mã sinh viên này.",
      });
    }

    const target = rows[0];
    await pool.query(
      "UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?",
      [target.id]
    );

    return res.status(200).json({
      success: true,
      message: `Đã mở khóa tài khoản ${target.full_name} (${target.student_code || target.email}) thành công!`,
      data: {
        id: target.id,
        fullName: target.full_name,
        email: target.email,
        studentCode: target.student_code,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function forceChangePassword(req, res, next) {
  try {
    const { challengeToken, newPassword } = req.body;
    if (typeof challengeToken !== "string" || !challengeToken.trim()) {
      return res.status(401).json({
        success: false,
        message: "Phiên đổi mật khẩu không hợp lệ. Vui lòng đăng nhập lại.",
      });
    }
    let decoded;
    try {
      decoded = jwt.verify(challengeToken.trim(), process.env.JWT_SECRET);
      if (decoded?.purpose !== "FORCE_CHANGE_PASSWORD" || !decoded?.id) {
        throw new Error("invalid");
      }
    } catch {
      return res.status(401).json({
        success: false,
        message: "Phiên đổi mật khẩu đã hết hạn. Vui lòng đăng nhập lại.",
      });
    }

    const passError = validateStrongPassword(newPassword);
    if (passError) {
      return res.status(400).json({ success: false, message: passError });
    }

    const nextHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE users
       SET password_hash = ?, must_change_password = 0, token_version = token_version + 1
       WHERE id = ?`,
      [nextHash, decoded.id]
    );
    invalidateTokenVersionCache(decoded.id);

    const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [decoded.id]);
    const updatedUser = rows[0];
    const token = signUserToken(updatedUser);

    return res.status(200).json({
      success: true,
      message: "Đặt mật khẩu mới thành công! Chào mừng bạn vào hệ thống.",
      data: {
        token,
        user: formatUserPayload(updatedUser),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getAdmins(req, res, next) {
  try {
    const [rows] = await pool.query(`
      SELECT id, full_name, email, role, is_super_admin, must_change_password, locked_until, created_at
      FROM users
      WHERE role IN ('TEACHER', 'ADMIN', 'SUPER_ADMIN')
      ORDER BY is_super_admin DESC, id ASC
    `);
    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
}

export async function createAdmin(req, res, next) {
  try {
    const { fullName, email, superAdminPassword } = req.body;
    if (!isText(fullName, 120) || !isText(email, 150) || typeof superAdminPassword !== "string" || !superAdminPassword) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập đầy đủ họ tên, email và mật khẩu xác nhận của Super Admin.",
      });
    }

    const [superRows] = await pool.query(
      "SELECT id, password_hash FROM users WHERE id = ? AND is_super_admin = 1",
      [req.user.id]
    );
    if (!superRows.length) {
      return res.status(403).json({
        success: false,
        message: "Chỉ Super Admin mới có quyền thêm Admin mới.",
      });
    }
    const superPassOk = await bcrypt.compare(superAdminPassword, superRows[0].password_hash);
    if (!superPassOk) {
      return res.status(401).json({
        success: false,
        message: "Mật khẩu xác nhận của Super Admin không chính xác.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const tempPassword = generateStrongTempPassword();
    const tempHash = await bcrypt.hash(tempPassword, 10);

    const [existing] = await pool.query("SELECT id, role FROM users WHERE email = ?", [
      normalizedEmail,
    ]);

    let adminId;
    if (existing.length > 0) {
      if (["TEACHER", "ADMIN", "SUPER_ADMIN"].includes(existing[0].role)) {
        return res.status(409).json({
          success: false,
          message: "Email này đã là tài khoản Admin trong hệ thống.",
        });
      }
      adminId = existing[0].id;
      await pool.query(
        `UPDATE users
         SET full_name = ?, role = 'TEACHER', is_super_admin = 0,
             password_hash = ?, must_change_password = 1, token_version = token_version + 1
         WHERE id = ?`,
        [fullName.trim(), tempHash, adminId]
      );
      invalidateTokenVersionCache(adminId);
    } else {
      const [inserted] = await pool.query(
        `INSERT INTO users (full_name, email, password_hash, role, is_super_admin, must_change_password)
         VALUES (?, ?, ?, 'TEACHER', 0, 1)`,
        [fullName.trim(), normalizedEmail, tempHash]
      );
      adminId = inserted.insertId;
    }

    await pool.query(
      `INSERT INTO admin_logs (admin_id, admin_name, action_type, exam_title, subject_code, details)
       VALUES (?, ?, 'CREATE_ADMIN', ?, NULL, ?)`,
      [
        req.user.id,
        req.user.fullName || "Super Admin",
        `${fullName.trim()} (${normalizedEmail})`,
        "Cấp quyền Admin mới (bắt buộc đổi mật khẩu lần đầu)",
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Đã tạo tài khoản Admin mới thành công! Hãy sao chép mật khẩu tạm thời bên dưới.",
      data: {
        id: adminId,
        fullName: fullName.trim(),
        email: normalizedEmail,
        tempPassword,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function revokeAdmin(req, res, next) {
  try {
    const targetId = Number(req.params.id);
    const [rows] = await pool.query(
      "SELECT id, full_name, email, role, is_super_admin FROM users WHERE id = ?",
      [targetId]
    );
    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy tài khoản Admin.",
      });
    }
    const target = rows[0];
    if (Number(target.is_super_admin) === 1) {
      return res.status(403).json({
        success: false,
        message: "Không thể thu hồi quyền của tài khoản Super Admin gốc.",
      });
    }

    await pool.query(
      `UPDATE users
       SET role = 'STUDENT', is_super_admin = 0, token_version = token_version + 1
       WHERE id = ?`,
      [targetId]
    );
    invalidateTokenVersionCache(targetId);

    await pool.query(
      `INSERT INTO admin_logs (admin_id, admin_name, action_type, exam_title, subject_code, details)
       VALUES (?, ?, 'REVOKE_ADMIN', ?, NULL, ?)`,
      [
        req.user.id,
        req.user.fullName || "Super Admin",
        `${target.full_name} (${target.email})`,
        "Thu hồi quyền Admin (hạ về STUDENT & hủy toàn bộ phiên đăng nhập)",
      ]
    );

    return res.status(200).json({
      success: true,
      message: `Đã thu hồi quyền Admin của ${target.full_name} thành công!`,
    });
  } catch (error) {
    next(error);
  }
}
