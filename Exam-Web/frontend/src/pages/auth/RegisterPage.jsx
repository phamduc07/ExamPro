import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { parsePtitEmail } from "../../utils/ptitHelper";

const OTP_LENGTH = 6;

export default function RegisterPage() {
  const { sendRegisterOtp, register, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [otpDigits, setOtpDigits] = useState(Array(OTP_LENGTH).fill(""));
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const otpRefs = useRef([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (step === 2) {
      otpRefs.current[0]?.focus();
    }
  }, [step]);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const parsedEmail = parsePtitEmail(form.email);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleRequestOtp = async (e) => {
    if (e) e.preventDefault();
    setError("");
    setNotice("");

    if (!parsedEmail.isValid) {
      setError(parsedEmail.error);
      return;
    }

    if (
      form.password.length < 8 ||
      !/[A-Z]/.test(form.password) ||
      !/[a-z]/.test(form.password) ||
      !/\d/.test(form.password)
    ) {
      setError("Mật khẩu phải có tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và chữ số.");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Mật khẩu xác nhận không khớp. Vui lòng kiểm tra lại.");
      return;
    }

    setSubmitting(true);
    try {
      const { confirmPassword, ...payload } = form;
      const res = await sendRegisterOtp(payload);
      setStep(2);
      setOtpDigits(Array(OTP_LENGTH).fill(""));
      setCooldown(res.data?.cooldownSeconds ?? 60);
      setNotice(
        res.message ||
          "Mã OTP 6 chữ số đã được gửi tới email sinh viên PTIT của bạn. Vui lòng kiểm tra hộp thư (kể cả mục Spam)."
      );
    } catch (err) {
      const retryAfter = err.response?.data?.data?.retryAfter;
      if (retryAfter) setCooldown(retryAfter);
      setError(
        err.response?.data?.message ||
          (err.response
            ? "Không thể gửi mã OTP. Vui lòng thử lại."
            : "Không thể kết nối tới máy chủ API. Hãy kiểm tra Backend đang chạy và đúng cổng cho phép.")
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpChange = (index, rawValue) => {
    const cleaned = rawValue.replace(/\D/g, "");
    if (!cleaned) {
      setOtpDigits((prev) => {
        const next = [...prev];
        next[index] = "";
        return next;
      });
      return;
    }

    if (cleaned.length > 1) {
      const pasted = cleaned.slice(0, OTP_LENGTH).split("");
      setOtpDigits((prev) => {
        const next = [...prev];
        for (let i = 0; i < OTP_LENGTH; i++) {
          next[i] = pasted[i] || "";
        }
        return next;
      });
      const focusIdx = Math.min(pasted.length, OTP_LENGTH - 1);
      otpRefs.current[focusIdx]?.focus();
      return;
    }

    setOtpDigits((prev) => {
      const next = [...prev];
      next[index] = cleaned;
      return next;
    });
    if (index < OTP_LENGTH - 1) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowLeft" && index > 0) {
      otpRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!text) return;
    const next = Array(OTP_LENGTH).fill("");
    text.split("").forEach((ch, idx) => {
      next[idx] = ch;
    });
    setOtpDigits(next);
    otpRefs.current[Math.min(text.length, OTP_LENGTH - 1)]?.focus();
  };

  const otpCode = otpDigits.join("");

  const handleVerifyAndRegister = async (e) => {
    e.preventDefault();
    setError("");

    if (!/^\d{6}$/.test(otpCode)) {
      setError("Vui lòng nhập đủ 6 chữ số mã OTP.");
      return;
    }

    setSubmitting(true);
    try {
      const { confirmPassword, ...payload } = form;
      await register({ ...payload, otp: otpCode });
      navigate("/login", {
        replace: true,
        state: {
          registeredEmail: payload.email.trim().toLowerCase(),
          successMessage: "Đăng ký và xác thực email PTIT thành công! Vui lòng đăng nhập bằng tài khoản vừa tạo.",
        },
      });
    } catch (err) {
      setError(
        err.response?.data?.message ||
          (err.response
            ? "Xác thực OTP hoặc đăng ký thất bại. Vui lòng thử lại."
            : "Không thể kết nối tới máy chủ API. Hãy kiểm tra Backend đang chạy và đúng cổng cho phép.")
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-layout">
      <div className="auth-hero">
        <div className="auth-hero-overlay" />
        <div className="auth-hero-content">
          <div className="hero-institute-tag">
            <span>HỌC VIỆN CÔNG NGHỆ BƯU CHÍNH VIỄN THÔNG</span>
          </div>
          <h1>
            Khởi đầu hành trình <br />
            <span className="text-gradient">Chinh phục kỳ thi</span>
          </h1>
          <p className="hero-desc">
            Sử dụng email sinh viên PTIT (@stu.ptit.edu.vn) để hệ thống tự động
            định danh Mã sinh viên và phân luồng đề thi theo đúng Khối ngành.
          </p>

          <div className="hero-feature-grid">
            <div className="hero-feature-item">
              <span className="feature-icon">🎓</span>
              <div>
                <strong>Tự động nhận diện MSV & Khối ngành</strong>
                <p>Trích xuất chuẩn MSV (VD: B25DCCC302) và phân Khối Kỹ thuật / Kinh tế từ email</p>
              </div>
            </div>
            <div className="hero-feature-item">
              <span className="feature-icon">✉️</span>
              <div>
                <strong>Xác thực email sinh viên qua mã OTP</strong>
                <p>Mã 6 chữ số gửi thẳng về hộp thư @stu.ptit.edu.vn, chống giả mạo MSV</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="auth-form-wrapper">
        <div className="auth-card">
          <div className="auth-card-header">
            <span className="section-badge">THÀNH VIÊN MỚI</span>
            <h2>{step === 1 ? "Đăng ký tài khoản" : "Xác thực Email PTIT"}</h2>
            <p>
              {step === 1
                ? "Sử dụng email @stu.ptit.edu.vn được Học viện cấp. MSV và Khối ngành được nhận diện tự động."
                : "Nhập mã OTP 6 chữ số chúng tôi vừa gửi tới email sinh viên của bạn."}
            </p>
          </div>

          <div className="register-steps" aria-label="Tiến trình đăng ký">
            <div className={`register-step-pill ${step === 1 ? "active" : "done"}`}>
              <span>{step > 1 ? "✓" : "1"}</span> Thông tin
            </div>
            <div className="register-step-line" />
            <div className={`register-step-pill ${step === 2 ? "active" : ""}`}>
              <span>2</span> Xác thực OTP
            </div>
          </div>

          {error && <div className="alert-box alert-error">⚠️ {error}</div>}
          {notice && !error && <div className="alert-box alert-success">✉️ {notice}</div>}

          {step === 1 ? (
            <form onSubmit={handleRequestOtp} className="auth-form">
              <div className="form-field">
                <label htmlFor="fullName">Họ và tên *</label>
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  placeholder="Nhập họ tên"
                  value={form.fullName}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-field">
                <label htmlFor="email">Email sinh viên PTIT (@stu.ptit.edu.vn) *</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="Nhập email PTIT"
                  value={form.email}
                  onChange={handleChange}
                  required
                />
                {form.email.trim() && !parsedEmail.isValid && (
                  <span className="field-hint-error">{parsedEmail.error}</span>
                )}
              </div>

              {parsedEmail.isValid && (
                <div className="ptit-auto-card valid">
                  <div className="ptit-auto-header">
                    <span>🎓 Thông tin trích xuất tự động từ Email</span>
                    <span
                      className={`major-group-badge ${
                        parsedEmail.majorGroup === "KY_THUAT" ? "tech" : "econ"
                      }`}
                    >
                      {parsedEmail.majorGroup === "KY_THUAT" ? "⚙️ " : "📈 "}
                      {parsedEmail.majorGroupLabel}
                    </span>
                  </div>

                  <div className="ptit-auto-grid">
                    <div className="ptit-auto-item">
                      <span className="ptit-auto-label">Mã sinh viên (Chuẩn)</span>
                      <strong className="ptit-auto-code">{parsedEmail.studentId}</strong>
                    </div>
                    <div className="ptit-auto-item">
                      <span className="ptit-auto-label">Ngành đào tạo ({parsedEmail.majorCode})</span>
                      <strong>{parsedEmail.majorName}</strong>
                    </div>
                  </div>
                </div>
              )}

              <div className="form-field">
                <label htmlFor="password">Mật khẩu (tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, số) *</label>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Nhập mật khẩu"
                  value={form.password}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-field">
                <label htmlFor="confirmPassword">Xác nhận lại mật khẩu *</label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="Nhập lại mật khẩu"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  required
                />
                {form.confirmPassword && form.password !== form.confirmPassword && (
                  <span className="field-hint-error">Mật khẩu xác nhận chưa khớp.</span>
                )}
              </div>

              <label className="show-password-toggle">
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                />
                <span>Hiển thị mật khẩu</span>
              </label>

              <button
                type="submit"
                className="btn-primary btn-full"
                disabled={submitting || !parsedEmail.isValid}
              >
                {submitting ? "Đang gửi mã OTP..." : "Gửi mã OTP xác thực →"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyAndRegister} className="auth-form">
              <div className="otp-email-banner">
                <div>
                  <span className="otp-email-label">
                    Email nhận mã • {parsedEmail.studentId} ({parsedEmail.majorGroupLabel})
                  </span>
                  <strong>{form.email.trim().toLowerCase()}</strong>
                </div>
                <button
                  type="button"
                  className="btn-link-inline"
                  disabled={submitting}
                  onClick={() => {
                    setStep(1);
                    setError("");
                    setNotice("");
                  }}
                >
                  Đổi email
                </button>
              </div>

              <div className="form-field">
                <label>Nhập mã OTP (6 chữ số) *</label>
                <div className="otp-digits-grid" onPaste={handleOtpPaste}>
                  {otpDigits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => {
                        otpRefs.current[idx] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      autoComplete={idx === 0 ? "one-time-code" : "off"}
                      maxLength={6}
                      className="otp-digit-input"
                      aria-label={`Chữ số OTP thứ ${idx + 1}`}
                      value={digit}
                      onChange={(e) => handleOtpChange(idx, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    />
                  ))}
                </div>
              </div>

              <div className="otp-actions-row">
                <span className="otp-expire-hint">Mã có hiệu lực trong 60 giây.</span>
                {cooldown > 0 ? (
                  <span className="otp-cooldown-text">Gửi lại sau {cooldown}s</span>
                ) : (
                  <button
                    type="button"
                    className="btn-link-inline"
                    disabled={submitting}
                    onClick={handleRequestOtp}
                  >
                    Gửi lại mã OTP
                  </button>
                )}
              </div>

              <button
                type="submit"
                className="btn-primary btn-full"
                disabled={submitting || otpCode.length !== OTP_LENGTH}
              >
                {submitting ? "Đang xác thực..." : "Xác nhận OTP & Hoàn tất đăng ký →"}
              </button>
            </form>
          )}

          <div className="auth-card-footer">
            Đã có tài khoản?{" "}
            <Link to="/login" className="link-highlight">
              Đăng nhập ngay
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
