import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const OTP_LENGTH = 6;

export default function LoginPage() {
  const {
    login,
    verifyAdminLoginOtp,
    forceChangePassword,
    resendAdminLoginOtp,
    forgotPassword,
    resetPassword,
    isAuthenticated,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState(location.state?.registeredEmail || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [successMessage, setSuccessMessage] = useState(location.state?.successMessage || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [forgotStep, setForgotStep] = useState(0);
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");

  const [otpChallenge, setOtpChallenge] = useState(null);
  const [forceChangeChallenge, setForceChangeChallenge] = useState(null);
  const [forceNewPassword, setForceNewPassword] = useState("");
  const [forceConfirmPassword, setForceConfirmPassword] = useState("");
  const [otpDigits, setOtpDigits] = useState(Array(OTP_LENGTH).fill(""));
  const [cooldown, setCooldown] = useState(0);
  const otpRefs = useRef([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (otpChallenge) {
      otpRefs.current[0]?.focus();
    }
  }, [otpChallenge]);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.requiresOtp) {
        setOtpChallenge({
          email: result.email,
          challengeToken: result.challengeToken,
        });
        setOtpDigits(Array(OTP_LENGTH).fill(""));
        setCooldown(result.cooldownSeconds ?? 60);
        setSuccessMessage(
          result.message || "Đã gửi mã OTP xác thực đăng nhập Admin tới Gmail của bạn."
        );
      } else {
        navigate("/");
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          (err.response
            ? "Đăng nhập thất bại. Vui lòng kiểm tra lại email hoặc mật khẩu."
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
      setOtpDigits(() => {
        const next = Array(OTP_LENGTH).fill("");
        pasted.forEach((ch, idx) => {
          next[idx] = ch;
        });
        return next;
      });
      otpRefs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus();
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

  const handleVerifyAdminOtp = async (e) => {
    e.preventDefault();
    setError("");
    if (!/^\d{6}$/.test(otpCode)) {
      setError("Vui lòng nhập đủ 6 chữ số mã OTP.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await verifyAdminLoginOtp(otpChallenge.challengeToken, otpCode);
      if (result?.requiresPasswordChange) {
        setOtpChallenge(null);
        setForceChangeChallenge({
          email: result.email,
          challengeToken: result.challengeToken,
        });
        setSuccessMessage(
          result.message || "Vui lòng đặt mật khẩu cá nhân mới trước khi vào hệ thống."
        );
      } else {
        navigate("/");
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          (err.response
            ? "Xác thực OTP thất bại. Vui lòng thử lại."
            : "Không thể kết nối tới máy chủ API.")
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendAdminOtp = async () => {
    if (!otpChallenge || submitting) return;
    setError("");
    setSuccessMessage("");
    setSubmitting(true);
    try {
      const res = await resendAdminLoginOtp(otpChallenge.challengeToken);
      setOtpChallenge((prev) => ({
        ...prev,
        challengeToken: res.data?.challengeToken || prev.challengeToken,
      }));
      setOtpDigits(Array(OTP_LENGTH).fill(""));
      setCooldown(res.data?.cooldownSeconds ?? 60);
      setSuccessMessage(res.message || "Đã gửi lại mã OTP mới tới Gmail của bạn.");
      otpRefs.current[0]?.focus();
    } catch (err) {
      const retryAfter = err.response?.data?.data?.retryAfter;
      if (retryAfter) setCooldown(retryAfter);
      setError(err.response?.data?.message || "Không thể gửi lại mã OTP.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleForceChangeSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (
      forceNewPassword.length < 8 ||
      !/[A-Z]/.test(forceNewPassword) ||
      !/[a-z]/.test(forceNewPassword) ||
      !/\d/.test(forceNewPassword)
    ) {
      setError("Mật khẩu mới phải có tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và chữ số.");
      return;
    }
    if (forceNewPassword !== forceConfirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }
    setSubmitting(true);
    try {
      await forceChangePassword(forceChangeChallenge.challengeToken, forceNewPassword);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.message || "Không thể cập nhật mật khẩu mới.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendForgotOtp = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");
    setSubmitting(true);
    try {
      const res = await forgotPassword(forgotEmail);
      setForgotStep(2);
      setSuccessMessage(res.message || "Mã OTP đặt lại mật khẩu đã được gửi về email.");
    } catch (err) {
      setError(err.response?.data?.message || "Không thể gửi mã OTP đặt lại mật khẩu.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmResetPassword = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");
    if (
      resetNewPassword.length < 8 ||
      !/[A-Z]/.test(resetNewPassword) ||
      !/[a-z]/.test(resetNewPassword) ||
      !/\d/.test(resetNewPassword)
    ) {
      setError("Mật khẩu mới phải có tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và chữ số.");
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await resetPassword(forgotEmail, resetOtp, resetNewPassword);
      setForgotStep(0);
      setEmail(forgotEmail);
      setPassword("");
      setResetOtp("");
      setResetNewPassword("");
      setResetConfirmPassword("");
      setSuccessMessage(res.message || "Đặt lại mật khẩu thành công! Vui lòng đăng nhập.");
    } catch (err) {
      setError(err.response?.data?.message || "Không thể đặt lại mật khẩu.");
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
            Hệ Thống Thi Trắc Nghiệm <br />
            <span className="text-gradient">Trực Tuyến PTIT ExamPro</span>
          </h1>
          <p className="hero-desc">
            Nền tảng tổ chức thi, quản lý ngân hàng câu hỏi và chấm điểm tự động
            chuẩn hóa theo quy trình đào tạo tín chỉ đại học.
          </p>

          <div className="hero-feature-grid">
            <div className="hero-feature-item">
              <span className="feature-icon">⏱️</span>
              <div>
                <strong>Làm bài đếm ngược thời gian thực</strong>
                <p>Tự động thu bài và chấm điểm ngay khi hết giờ</p>
              </div>
            </div>
            <div className="hero-feature-item">
              <span className="feature-icon">🗂️</span>
              <div>
                <strong>Ngân hàng câu hỏi đa môn học</strong>
                <p>Phân loại theo mức độ Dễ, Trung bình, Khó kèm lời giải</p>
              </div>
            </div>
            <div className="hero-feature-item">
              <span className="feature-icon">📊</span>
              <div>
                <strong>Thống kê & Xem lại đáp án chi tiết</strong>
                <p>Đối chiếu từng câu đúng/sai và phổ điểm trực quan</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="auth-form-wrapper">
        <div className="auth-card">
          <div className="auth-card-header">
            <span className="section-badge">
              {otpChallenge ? "BẢO MẬT QUẢN TRỊ VIÊN (2FA)" : "CHÀO MỪNG TRỞ LẠI"}
            </span>
            <h2>{otpChallenge ? "Xác thực OTP Admin" : "Đăng nhập tài khoản"}</h2>
            <p>
              {otpChallenge
                ? "Nhập mã OTP 6 chữ số vừa được gửi về Gmail quản trị để hoàn tất đăng nhập."
                : "Sử dụng tài khoản của bạn để tiếp tục vào hệ thống"}
            </p>
          </div>

          {successMessage && !error && (
            <div className="alert-box alert-success">✅ {successMessage}</div>
          )}
          {error && <div className="alert-box alert-error">⚠️ {error}</div>}

          {forceChangeChallenge ? (
            <form onSubmit={handleForceChangeSubmit} className="auth-form">
              <div className="otp-email-banner">
                <div>
                  <span className="otp-email-label">🔐 Bắt buộc đổi mật khẩu lần đầu</span>
                  <strong>{forceChangeChallenge.email}</strong>
                </div>
              </div>
              <div className="form-field">
                <label>Mật khẩu mới (>= 8 ký tự, chữ hoa, chữ thường, số) *</label>
                <input
                  type="password"
                  placeholder="Nhập mật khẩu cá nhân mới"
                  value={forceNewPassword}
                  onChange={(e) => setForceNewPassword(e.target.value)}
                  required
                />
              </div>
              <div className="form-field">
                <label>Xác nhận mật khẩu mới *</label>
                <input
                  type="password"
                  placeholder="Nhập lại mật khẩu mới"
                  value={forceConfirmPassword}
                  onChange={(e) => setForceConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn-primary btn-full" disabled={submitting}>
                {submitting ? "Đang cập nhật..." : "Lưu mật khẩu & Vào hệ thống →"}
              </button>
            </form>
          ) : forgotStep > 0 ? (
            forgotStep === 1 ? (
              <form onSubmit={handleSendForgotOtp} className="auth-form">
                <div className="form-field">
                  <label htmlFor="forgot-email">Email tài khoản *</label>
                  <input
                    id="forgot-email"
                    type="email"
                    placeholder="Nhập email đã đăng ký"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn-primary btn-full" disabled={submitting}>
                  {submitting ? "Đang gửi OTP..." : "Gửi mã OTP đặt lại mật khẩu →"}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-full"
                  onClick={() => {
                    setForgotStep(0);
                    setError("");
                  }}
                >
                  ← Quay lại đăng nhập
                </button>
              </form>
            ) : (
              <form onSubmit={handleConfirmResetPassword} className="auth-form">
                <div className="form-field">
                  <label>Mã OTP (6 chữ số) *</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Nhập mã OTP 6 chữ số"
                    value={resetOtp}
                    onChange={(e) => setResetOtp(e.target.value.replace(/\D/g, ""))}
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Mật khẩu mới (>= 8 ký tự, chữ hoa, chữ thường, số) *</label>
                  <input
                    type="password"
                    placeholder="Nhập mật khẩu mới"
                    value={resetNewPassword}
                    onChange={(e) => setResetNewPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Xác nhận mật khẩu mới *</label>
                  <input
                    type="password"
                    placeholder="Nhập lại mật khẩu mới"
                    value={resetConfirmPassword}
                    onChange={(e) => setResetConfirmPassword(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn-primary btn-full" disabled={submitting}>
                  {submitting ? "Đang đặt lại..." : "Xác nhận đổi mật khẩu →"}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-full"
                  onClick={() => {
                    setForgotStep(0);
                    setError("");
                  }}
                >
                  ← Quay lại đăng nhập
                </button>
              </form>
            )
          ) : !otpChallenge ? (
            <form onSubmit={handleSubmit} className="auth-form">
              <div className="form-field">
                <label htmlFor="email">Địa chỉ Email</label>
                <input
                  id="email"
                  type="email"
                  placeholder="Nhập gmail của bạn"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-field">
                <label htmlFor="password">Mật khẩu</label>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Nhập mật khẩu..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                <label className="show-password-toggle">
                  <input
                    type="checkbox"
                    checked={showPassword}
                    onChange={(e) => setShowPassword(e.target.checked)}
                  />
                  <span>Hiển thị mật khẩu</span>
                </label>

                <button
                  type="button"
                  className="btn-link-inline"
                  onClick={() => {
                    setForgotEmail(email);
                    setForgotStep(1);
                    setError("");
                    setSuccessMessage("");
                  }}
                >
                  Quên mật khẩu?
                </button>
              </div>

              <button type="submit" className="btn-primary btn-full" disabled={submitting}>
                {submitting ? "Đang xác thực..." : "Đăng nhập vào hệ thống →"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyAdminOtp} className="auth-form">
              <div className="otp-email-banner">
                <div>
                  <span className="otp-email-label">Gmail Quản trị viên nhận mã OTP</span>
                  <strong>{otpChallenge.email}</strong>
                </div>
                <button
                  type="button"
                  className="btn-link-inline"
                  disabled={submitting}
                  onClick={() => {
                    setOtpChallenge(null);
                    setOtpDigits(Array(OTP_LENGTH).fill(""));
                    setError("");
                    setSuccessMessage("");
                  }}
                >
                  Quay lại
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
                <span className="otp-expire-hint">Mã có hiệu lực trong 5 phút.</span>
                {cooldown > 0 ? (
                  <span className="otp-cooldown-text">Gửi lại sau {cooldown}s</span>
                ) : (
                  <button
                    type="button"
                    className="btn-link-inline"
                    disabled={submitting}
                    onClick={handleResendAdminOtp}
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
                {submitting ? "Đang xác thực OTP..." : "Xác nhận OTP & Đăng nhập Admin →"}
              </button>
            </form>
          )}

          <div className="auth-card-footer">
            Chưa có tài khoản?{" "}
            <Link to="/register" className="link-highlight">
              Đăng ký tài khoản mới
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
