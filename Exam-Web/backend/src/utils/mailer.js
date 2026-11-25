import dns from "node:dns/promises";
import nodemailer from "nodemailer";

let customMailSender = null;
let customEmailVerifier = null;

export function setMailSenderForTests(sender) {
  customMailSender = sender;
}

export function setEmailVerifierForTests(verifier) {
  customEmailVerifier = verifier;
}

export async function verifyEmailExists(email) {
  if (customEmailVerifier) {
    return customEmailVerifier(email);
  }
  const domain = String(email || "").split("@")[1]?.trim().toLowerCase();
  if (!domain || !domain.includes(".")) {
    return false;
  }
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error("DNS_TIMEOUT"), { code: "ETIMEOUT" })), 5000)
      ),
    ]);
    return Array.isArray(records) && records.some((r) => r.exchange && r.exchange !== ".");
  } catch (error) {
    if (["ENOTFOUND", "ENODATA", "ENOENT", "EBADNAME", "EREFUSED", "ENOTIMP"].includes(error.code)) {
      return false;
    }
    return true;
  }
}

function getSmtpConfig() {
  const host = (process.env.SMTP_HOST || "smtp.gmail.com").trim();
  const port = Number(process.env.SMTP_PORT) || 465;
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465;
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
  const from = (process.env.SMTP_FROM || `PTIT ExamPro <${user}>`).trim();
  return { host, port, secure, user, pass, from };
}

export function isMailerConfigured() {
  if (customMailSender) return true;
  const { user, pass } = getSmtpConfig();
  return Boolean(
    user &&
      pass &&
      user !== "your_gmail@gmail.com" &&
      pass !== "your_gmail_app_password"
  );
}

export async function sendRegisterOtpEmail({ to, fullName, otp, expiresMinutes = 5 }) {
  return sendOtpMailInternal({
    to,
    fullName,
    otp,
    expiresMinutes,
    subject: `[PTIT ExamPro] Mã xác thực đăng ký tài khoản: ${otp}`,
    title: "Xác thực đăng ký tài khoản",
    intro:
      "Cảm ơn bạn đã đăng ký tài khoản trên hệ thống thi trắc nghiệm trực tuyến <strong>PTIT ExamPro</strong>. Vui lòng nhập mã OTP bên dưới để xác nhận địa chỉ email của bạn:",
    footerNote: "Nếu bạn không thực hiện đăng ký, hãy bỏ qua email này.",
    purpose: "REGISTER",
  });
}

export async function sendAdminLoginOtpEmail({ to, fullName, otp, expiresMinutes = 5 }) {
  return sendOtpMailInternal({
    to,
    fullName,
    otp,
    expiresMinutes,
    subject: `[PTIT ExamPro] Mã OTP đăng nhập Quản trị viên (Admin): ${otp}`,
    title: "Xác thực đăng nhập Quản trị viên",
    intro:
      "Có một yêu cầu <strong>đăng nhập quyền Quản trị viên (Admin)</strong> vào hệ thống <strong>PTIT ExamPro</strong>. Vui lòng nhập mã OTP bên dưới để xác nhận đây là bạn:",
    footerNote: "Nếu KHÔNG PHẢI bạn vừa đăng nhập, hãy đổi mật khẩu Admin ngay lập tức.",
    purpose: "ADMIN_LOGIN",
  });
}

export async function sendPasswordResetOtpEmail({ to, fullName, otp, expiresMinutes = 5 }) {
  return sendOtpMailInternal({
    to,
    fullName,
    otp,
    expiresMinutes,
    subject: `[PTIT ExamPro] Mã OTP đặt lại mật khẩu: ${otp}`,
    title: "Đặt lại mật khẩu tài khoản",
    intro:
      "Chúng tôi nhận được yêu cầu <strong>đặt lại mật khẩu</strong> cho tài khoản <strong>PTIT ExamPro</strong> của bạn. Vui lòng nhập mã OTP bên dưới để tiếp tục:",
    footerNote: "Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.",
    purpose: "PASSWORD_RESET",
  });
}

async function sendOtpMailInternal({ to, fullName, otp, expiresMinutes = 5, subject, title, intro, footerNote, purpose }) {
  if (customMailSender) {
    return customMailSender({ to, fullName, otp, expiresMinutes, purpose });
  }

  if (!isMailerConfigured()) {
    throw Object.assign(
      new Error("Hệ thống gửi email OTP chưa được cấu hình. Hãy điền SMTP_USER và SMTP_PASS trong backend/.env."),
      { statusCode: 503 }
    );
  }

  const { host, port, secure, user, pass, from } = getSmtpConfig();

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  const safeName = (fullName || "bạn").replace(/[<>&"]/g, "");

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text:
        `Xin chào ${safeName},\n\n` +
        `${title} - Mã OTP của bạn là: ${otp}\n` +
        `Mã có hiệu lực trong ${expiresMinutes} phút. Tuyệt đối không chia sẻ mã này cho người khác.\n\n` +
        `${footerNote}`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #0f172a; color: #e2e8f0; border-radius: 16px; overflow: hidden; border: 1px solid #1e293b;">
          <div style="background: linear-gradient(135deg, #e11d48, #2563eb); padding: 24px 28px; text-align: center;">
            <div style="font-size: 12px; letter-spacing: 2px; font-weight: 700; color: rgba(255,255,255,0.88); text-transform: uppercase;">Học viện Công nghệ Bưu chính Viễn thông</div>
            <h1 style="margin: 6px 0 0; font-size: 24px; color: #ffffff;">PTIT ExamPro</h1>
          </div>
          <div style="padding: 28px;">
            <p style="margin: 0 0 12px; font-size: 15px;">Xin chào <strong>${safeName}</strong>,</p>
            <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
              ${intro}
            </p>
            <div style="background: #1e293b; border: 1px dashed #38bdf8; border-radius: 12px; padding: 18px; text-align: center; margin: 22px 0;">
              <div style="font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px;">Mã xác thực OTP</div>
              <div style="font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #38bdf8; font-family: Consolas, monospace;">${otp}</div>
            </div>
            <p style="margin: 0 0 8px; font-size: 13px; color: #94a3b8;">
              • Mã OTP có hiệu lực trong vòng <strong style="color: #f8fafc;">${expiresMinutes} phút</strong>.
            </p>
            <p style="margin: 0; font-size: 13px; color: #94a3b8;">
              • Không chia sẻ mã này cho bất kỳ ai. ${footerNote}
            </p>
          </div>
          <div style="background: #020617; padding: 14px 28px; text-align: center; font-size: 12px; color: #64748b;">
            Email được gửi tự động từ hệ thống PTIT ExamPro. Vui lòng không trả lời email này.
          </div>
        </div>
      `,
    });
    if (Array.isArray(info?.rejected) && info.rejected.length > 0) {
      throw Object.assign(new Error("Email không tồn tại."), { statusCode: 400 });
    }
  } catch (error) {
    if (error.statusCode === 400) throw error;
    console.error("📧 [Mailer Error]:", error.code || error.message);
    if (error.code === "EENVELOPE" || [550, 551, 553].includes(error.responseCode)) {
      throw Object.assign(new Error("Email không tồn tại."), { statusCode: 400 });
    }
    if (error.code === "EAUTH" || error.responseCode === 535) {
      throw Object.assign(
        new Error("Xác thực email gửi đi thất bại. Hãy kiểm tra lại SMTP_USER và Mật khẩu ứng dụng (SMTP_PASS) trong backend/.env."),
        { statusCode: 502 }
      );
    }
    throw Object.assign(
      new Error("Không thể gửi email xác thực OTP lúc này. Vui lòng kiểm tra kết nối mạng và cấu hình SMTP."),
      { statusCode: 502 }
    );
  }
}


export async function sendNewAdminCredentialsEmail({ to, fullName, tempPassword }) {
  const host = (process.env.SMTP_HOST || "smtp.gmail.com").trim();
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === "true"
    : port === 465;
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
  const from = (process.env.SMTP_FROM || `PTIT ExamPro <${user}>`).trim();

  if (!user || !pass) {
    return false;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  const safeName = (fullName || "Quản trị viên").replace(/[<>&"]/g, "");

  try {
    await transporter.sendMail({
      from,
      to,
      subject: "[PTIT ExamPro] Thông báo cấp quyền Quản trị viên & Mật khẩu tạm thời",
      text:
        `Xin chào ${safeName},\n\n` +
        `Bạn vừa được Super Admin cấp quyền Quản trị viên (Admin) trên hệ thống PTIT ExamPro.\n` +
        `Email đăng nhập: ${to}\n` +
        `Mật khẩu tạm thời: ${tempPassword}\n\n` +
        `Lưu ý: Bạn bắt buộc phải đổi mật khẩu cá nhân ngay trong lần đăng nhập đầu tiên và chờ Super Admin phê duyệt sau khi xác thực OTP.\n`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #0f172a; color: #e2e8f0; border-radius: 16px; overflow: hidden; border: 1px solid #1e293b;">
          <div style="background: linear-gradient(135deg, #e11d48, #2563eb); padding: 24px 28px; text-align: center;">
            <div style="font-size: 12px; letter-spacing: 2px; font-weight: 700; color: rgba(255,255,255,0.88); text-transform: uppercase;">Học viện Công nghệ Bưu chính Viễn thông</div>
            <h1 style="margin: 6px 0 0; font-size: 24px; color: #ffffff;">PTIT ExamPro</h1>
          </div>
          <div style="padding: 28px;">
            <p style="margin: 0 0 12px; font-size: 15px;">Xin chào <strong>${safeName}</strong>,</p>
            <p style="margin: 0 0 18px; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
              Bạn vừa được Super Admin cấp quyền <strong>Quản trị viên (Admin)</strong> trên hệ thống PTIT ExamPro.
            </p>
            <div style="background: #1e293b; border: 1px dashed #38bdf8; border-radius: 12px; padding: 18px; text-align: center; margin: 20px 0;">
              <div style="font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px;">Mật khẩu tạm thời</div>
              <div style="font-size: 24px; font-weight: 800; letter-spacing: 2px; color: #38bdf8; font-family: Consolas, monospace;">${tempPassword}</div>
            </div>
            <p style="margin: 0 0 8px; font-size: 13px; color: #94a3b8;">
              • Email đăng nhập: <strong style="color: #f8fafc;">${to}</strong>
            </p>
            <p style="margin: 0; font-size: 13px; color: #94a3b8;">
              • Bạn bắt buộc phải <strong style="color: #f8fafc;">đổi mật khẩu cá nhân ngay trong lần đăng nhập đầu tiên</strong>.
            </p>
          </div>
          <div style="background: #020617; padding: 14px 28px; text-align: center; font-size: 12px; color: #64748b;">
            Email được gửi tự động từ hệ thống PTIT ExamPro. Vui lòng không trả lời email này.
          </div>
        </div>
      `,
    });
    return true;
  } catch (error) {
    console.error("📧 [New Admin Mailer Warning]:", error.code || error.message);
    return false;
  }
}
