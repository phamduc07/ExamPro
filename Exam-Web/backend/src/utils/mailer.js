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

function getBrevoApiKey() {
  return (process.env.BREVO_API_KEY || "").trim();
}

export function isMailerConfigured() {
  if (customMailSender) return true;
  if (getBrevoApiKey()) return true;
  const { user, pass } = getSmtpConfig();
  return Boolean(
    user &&
      pass &&
      user !== "your_gmail@gmail.com" &&
      pass !== "your_gmail_app_password"
  );
}

function parseSender(fromStr, fallbackEmail) {
  const match = String(fromStr || "").match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].replace(/["']/g, "").trim() || "PTIT ExamPro",
      email: match[2].trim(),
    };
  }
  return {
    name: "PTIT ExamPro",
    email: String(fromStr || fallbackEmail || "").trim(),
  };
}

async function dispatchEmail({ to, subject, text, html }) {
  const brevoApiKey = getBrevoApiKey();
  const { host, port, secure, user, pass, from } = getSmtpConfig();

  if (brevoApiKey) {
    const sender = parseSender(from, user || "examptit@gmail.com");
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": brevoApiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender,
        to: [{ email: String(to).trim() }],
        subject,
        textContent: text,
        htmlContent: html,
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const errMsg = errBody.message || `Brevo API HTTP ${response.status}`;
      const err = new Error(errMsg);
      if (response.status === 400 && /invalid.*email/i.test(errMsg)) {
        err.code = "EENVELOPE";
      } else if (response.status === 401 || response.status === 403) {
        err.code = "EAUTH";
      }
      throw err;
    }
    return;
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

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });

  if (Array.isArray(info?.rejected) && info.rejected.length > 0) {
    throw Object.assign(new Error("Email không tồn tại."), { statusCode: 400 });
  }
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
      new Error("Hệ thống gửi email OTP chưa được cấu hình. Hãy điền BREVO_API_KEY hoặc SMTP_USER trong cấu hình."),
      { statusCode: 503 }
    );
  }

  const safeName = (fullName || "bạn").replace(/[<>&"]/g, "");

  try {
    await dispatchEmail({
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
- Mã OTP có hiệu lực trong vòng <strong style="color: #f8fafc;">${expiresMinutes} phút</strong>.
            </p>
            <p style="margin: 0; font-size: 13px; color: #94a3b8;">
- Không chia sẻ mã này cho bất kỳ ai. ${footerNote}
            </p>
          </div>
          <div style="background: #020617; padding: 14px 28px; text-align: center; font-size: 12px; color: #64748b;">
            Email được gửi tự động từ hệ thống PTIT ExamPro. Vui lòng không trả lời email này.
          </div>
        </div>
      `,
    });
  } catch (error) {
    if (error.statusCode === 400) throw error;
    console.error("📧 [Mailer Error]:", error.code || error.message);
    if (error.code === "EENVELOPE" || [550, 551, 553].includes(error.responseCode)) {
      throw Object.assign(new Error("Email không tồn tại."), { statusCode: 400 });
    }
    if (error.code === "EAUTH" || error.responseCode === 535) {
      throw Object.assign(
        new Error("Xác thực dịch vụ gửi email thất bại. Hãy kiểm tra lại BREVO_API_KEY hoặc cấu hình SMTP."),
        { statusCode: 502 }
      );
    }
    throw Object.assign(
      new Error("Không thể gửi email xác thực OTP lúc này. Vui lòng kiểm tra kết nối mạng và cấu hình gửi thư."),
      { statusCode: 502 }
    );
  }
}

export async function sendNewAdminCredentialsEmail({ to, fullName, tempPassword }) {
  if (!isMailerConfigured()) {
    return false;
  }

  const safeName = (fullName || "Quản trị viên").replace(/[<>&"]/g, "");

  try {
    await dispatchEmail({
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
- Email đăng nhập: <strong style="color: #f8fafc;">${to}</strong>
            </p>
            <p style="margin: 0; font-size: 13px; color: #94a3b8;">
- Bạn bắt buộc phải <strong style="color: #f8fafc;">đổi mật khẩu cá nhân ngay trong lần đăng nhập đầu tiên</strong>.
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

export async function sendPromoteAdminEmail({ to, fullName }) {
  if (!isMailerConfigured()) {
    return false;
  }

  const safeName = (fullName || "Quản trị viên").replace(/[<>&"]/g, "");

  try {
    await dispatchEmail({
      to,
      subject: "[PTIT ExamPro] Thông báo nâng cấp tài khoản lên Quản trị viên",
      text:
        `Xin chào ${safeName},\n\n` +
        `Tài khoản Sinh viên của bạn (${to}) vừa được Super Admin nâng cấp lên quyền Quản trị viên (Admin) trên hệ thống PTIT ExamPro.\n` +
        `Bạn tiếp tục sử dụng mật khẩu hiện tại của mình để đăng nhập và chờ Super Admin phê duyệt trong lần đăng nhập đầu tiên.\n`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #0f172a; color: #e2e8f0; border-radius: 16px; overflow: hidden; border: 1px solid #1e293b;">
          <div style="background: linear-gradient(135deg, #e11d48, #2563eb); padding: 24px 28px; text-align: center;">
            <div style="font-size: 12px; letter-spacing: 2px; font-weight: 700; color: rgba(255,255,255,0.88); text-transform: uppercase;">Học viện Công nghệ Bưu chính Viễn thông</div>
            <h1 style="margin: 6px 0 0; font-size: 24px; color: #ffffff;">PTIT ExamPro</h1>
          </div>
          <div style="padding: 28px;">
            <p style="margin: 0 0 12px; font-size: 15px;">Xin chào <strong>${safeName}</strong>,</p>
            <p style="margin: 0 0 18px; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
              Tài khoản của bạn (<strong style="color: #f8fafc;">${to}</strong>) vừa được Super Admin nâng cấp lên quyền <strong>Quản trị viên (Admin)</strong> trên hệ thống PTIT ExamPro.
            </p>
            <p style="margin: 0; font-size: 13px; color: #94a3b8;">
- Mật khẩu hiện tại của bạn được giữ nguyên. Trong lần đăng nhập đầu tiên với quyền Admin, bạn sẽ cần xác thực OTP và chờ Super Admin phê duyệt.
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
    console.error("📧 [Promote Admin Mailer Warning]:", error.code || error.message);
    return false;
  }
}