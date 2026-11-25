import crypto from "node:crypto";
import dns from "node:dns/promises";
import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";
import { isText } from "../utils/validation.js";
import { invalidateTokenVersionCache } from "../middlewares/authMiddleware.js";
import { sendNewAdminCredentialsEmail, sendPromoteAdminEmail } from "../utils/mailer.js";
import { parsePtitEmail, KY_THUAT_MAJORS, KINH_TE_MAJORS } from "../utils/ptitHelper.js";

const superAdminPwdFailures = new Map();
const MAX_SUPER_ADMIN_CONFIRM_FAILS = 5;

async function isValidEmailWithMx(email) {
  const normalized = String(email || "").trim().toLowerCase();
  const basicRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!basicRegex.test(normalized)) return false;
  const domain = normalized.split("@")[1];
  try {
    const records = await dns.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
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
      `SELECT id, full_name, email, role, student_code
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
    if (target.role !== "STUDENT") {
      return res.status(403).json({
        success: false,
        message: "Chỉ được phép mở khóa cho tài khoản Sinh viên.",
      });
    }

    await pool.query(
      "UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ? AND role = 'STUDENT'",
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

export async function getAdmins(req, res, next) {
  try {
    const [rows] = await pool.query(`
      SELECT id, full_name, email, role, is_super_admin, first_login_approved, pending_first_login, must_change_password, locked_until, created_at
      FROM users
      WHERE role IN ('TEACHER', 'ADMIN', 'SUPER_ADMIN')
      ORDER BY pending_first_login DESC, is_super_admin DESC, id ASC
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
    const { fullName, email, superAdminPassword, confirmPromote } = req.body;
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
      const nextFails = (superAdminPwdFailures.get(req.user.id) || 0) + 1;
      if (nextFails > MAX_SUPER_ADMIN_CONFIRM_FAILS) {
        superAdminPwdFailures.delete(req.user.id);
        return res.status(400).json({
          success: false,
          forceLogout: true,
          message: "Bạn đã nhập sai mật khẩu quá 5 lần. Hệ thống tự động đăng xuất.",
        });
      }
      superAdminPwdFailures.set(req.user.id, nextFails);
      const remaining = MAX_SUPER_ADMIN_CONFIRM_FAILS - nextFails;
      return res.status(400).json({
        success: false,
        remainingAttempts: remaining,
        message: `Mật khẩu bạn nhập sai (Còn ${remaining}/${MAX_SUPER_ADMIN_CONFIRM_FAILS} lần thử)`,
      });
    }
    superAdminPwdFailures.delete(req.user.id);

    const normalizedEmail = email.trim().toLowerCase();
    const [existing] = await pool.query(
      "SELECT id, full_name, email, role FROM users WHERE email = ?",
      [normalizedEmail]
    );

    if (existing.length > 0) {
      const existingUser = existing[0];
      if (["TEACHER", "ADMIN", "SUPER_ADMIN"].includes(existingUser.role)) {
        return res.status(400).json({
          success: false,
          message: "Email này đã thuộc về một Quản trị viên trên hệ thống.",
        });
      }

      if (existingUser.role === "STUDENT" && !confirmPromote) {
        return res.status(409).json({
          success: false,
          requirePromoteConfirm: true,
          studentName: existingUser.full_name,
          email: existingUser.email,
          message: "Email này đang là tài khoản Sinh viên.",
        });
      }

      await pool.query(
        `UPDATE users
         SET role = 'TEACHER', is_super_admin = 0,
             first_login_approved = 0, pending_first_login = 0,
             must_change_password = 0, token_version = token_version + 1
         WHERE id = ?`,
        [existingUser.id]
      );
      invalidateTokenVersionCache(existingUser.id);

      await pool.query(
        `INSERT INTO admin_logs (admin_id, admin_name, action_type, exam_title, subject_code, details)
         VALUES (?, ?, 'CREATE_ADMIN', ?, NULL, ?)`,
        [
          req.user.id,
          req.user.fullName || "Super Admin",
          `${existingUser.full_name} (${existingUser.email})`,
          "Nâng cấp tài khoản Sinh viên lên Quản trị viên (giữ nguyên mật khẩu hiện tại)",
        ]
      );

      await sendPromoteAdminEmail({
        to: existingUser.email,
        fullName: existingUser.full_name,
      });

      return res.status(200).json({
        success: true,
        promoted: true,
        message: `Đã nâng cấp tài khoản Sinh viên "${existingUser.full_name}" lên Quản trị viên thành công!`,
        data: {
          id: existingUser.id,
          fullName: existingUser.full_name,
          email: existingUser.email,
          promoted: true,
        },
      });
    }

    const mxOk = await isValidEmailWithMx(normalizedEmail);
    if (!mxOk) {
      return res.status(400).json({
        success: false,
        message: "Email không tồn tại hoặc không hợp lệ",
      });
    }

    const finalPassword = generateStrongTempPassword();
    const mustChange = 1;
    const passwordHash = await bcrypt.hash(finalPassword, 10);

    const [inserted] = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role, is_super_admin, first_login_approved, pending_first_login, must_change_password)
       VALUES (?, ?, ?, 'TEACHER', 0, 0, 0, ?)`,
      [fullName.trim(), normalizedEmail, passwordHash, mustChange]
    );
    const adminId = inserted.insertId;

    await pool.query(
      `INSERT INTO admin_logs (admin_id, admin_name, action_type, exam_title, subject_code, details)
       VALUES (?, ?, 'CREATE_ADMIN', ?, NULL, ?)`,
      [
        req.user.id,
        req.user.fullName || "Super Admin",
        `${fullName.trim()} (${normalizedEmail})`,
        "Cấp quyền Admin mới (yêu cầu Super Admin duyệt lần đăng nhập đầu tiên)",
      ]
    );

    await sendNewAdminCredentialsEmail({
      to: normalizedEmail,
      fullName: fullName.trim(),
      tempPassword: finalPassword,
    });

    return res.status(201).json({
      success: true,
      message: "Đã tạo tài khoản Admin mới và gửi mật khẩu tạm thời qua email!",
      data: {
        id: adminId,
        fullName: fullName.trim(),
        email: normalizedEmail,
        tempPassword: finalPassword,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteAdmin(req, res, next) {
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
        message: "Không thể xóa tài khoản Super Admin gốc.",
      });
    }
    if (target.role !== "TEACHER") {
      return res.status(403).json({
        success: false,
        message: "Chỉ được phép xóa tài khoản Quản trị viên thường.",
      });
    }

    await pool.query("DELETE FROM login_otps WHERE user_id = ?", [targetId]);
    await pool.query("DELETE FROM users WHERE id = ? AND role = 'TEACHER' AND is_super_admin = 0", [targetId]);
    invalidateTokenVersionCache(targetId);

    await pool.query(
      `INSERT INTO admin_logs (admin_id, admin_name, action_type, exam_title, subject_code, details)
       VALUES (?, ?, 'REVOKE_ADMIN', ?, NULL, ?)`,
      [
        req.user.id,
        req.user.fullName || "Super Admin",
        `${target.full_name} (${target.email})`,
        "Xóa tài khoản Admin khỏi hệ thống",
      ]
    );

    return res.status(200).json({
      success: true,
      message: `Đã xóa tài khoản Admin ${target.full_name} thành công!`,
    });
  } catch (error) {
    next(error);
  }
}

export async function approveAdminFirstLogin(req, res, next) {
  try {
    const targetId = Number(req.params.id);
    const [rows] = await pool.query(
      "SELECT id, full_name, email FROM users WHERE id = ? AND role IN ('TEACHER', 'ADMIN')",
      [targetId]
    );
    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy tài khoản Admin.",
      });
    }
    await pool.query(
      "UPDATE users SET first_login_approved = 1, pending_first_login = 0 WHERE id = ?",
      [targetId]
    );
    return res.status(200).json({
      success: true,
      message: `Đã phê duyệt cho phép Admin ${rows[0].full_name} đăng nhập!`,
    });
  } catch (error) {
    next(error);
  }
}

export async function rejectAdminFirstLogin(req, res, next) {
  try {
    const targetId = Number(req.params.id);
    const [rows] = await pool.query(
      "SELECT id, full_name, email FROM users WHERE id = ? AND role IN ('TEACHER', 'ADMIN')",
      [targetId]
    );
    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy tài khoản Admin.",
      });
    }
    await pool.query(
      "UPDATE users SET pending_first_login = 0 WHERE id = ?",
      [targetId]
    );
    return res.status(200).json({
      success: true,
      message: `Đã từ chối yêu cầu đăng nhập lần đầu của Admin ${rows[0].full_name}.`,
    });
  } catch (error) {
    next(error);
  }
}

export async function revokeAdmin(req, res, next) {
  try {
    const targetId = Number(req.params.id);
    const [rows] = await pool.query(
      "SELECT id, full_name, email, role, is_super_admin, student_code, major_group FROM users WHERE id = ?",
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

    const parsedEmailInfo = parsePtitEmail(target.email || "");
    const preservedStudentCode =
      target.student_code || (parsedEmailInfo.isValid ? parsedEmailInfo.studentId : null);
    const preservedMajorGroup =
      target.major_group || (parsedEmailInfo.isValid ? parsedEmailInfo.majorGroup : null);

    await pool.query(
      `UPDATE users
       SET role = 'STUDENT',
           is_super_admin = 0,
           first_login_approved = 0,
           pending_first_login = 0,
           student_code = ?,
           major_group = ?,
           token_version = token_version + 1
       WHERE id = ?`,
      [preservedStudentCode, preservedMajorGroup, targetId]
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

