import { useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function MainLayout() {
  const { user, logout, changePassword } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [showChangePwdModal, setShowChangePwdModal] = useState(false);
  const [pwdForm, setPwdForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [pwdError, setPwdError] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleChangePasswordSubmit = async (e) => {
    e.preventDefault();
    setPwdError("");
    const { currentPassword, newPassword, confirmPassword } = pwdForm;
    if (
      newPassword.length < 8 ||
      !/[A-Z]/.test(newPassword) ||
      !/[a-z]/.test(newPassword) ||
      !/\d/.test(newPassword)
    ) {
      setPwdError("Mật khẩu mới phải có tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và chữ số.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError("Mật khẩu xác nhận không khớp.");
      return;
    }
    setPwdSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setShowChangePwdModal(false);
      setPwdForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      await logout();
      navigate("/login", {
        replace: true,
        state: {
          successMessage: "Đổi mật khẩu thành công! Vui lòng đăng nhập lại bằng mật khẩu mới.",
        },
      });
    } catch (err) {
      setPwdError(err.response?.data?.message || "Không thể đổi mật khẩu.");
    } finally {
      setPwdSaving(false);
    }
  };

  const isTeacher = user?.role === "TEACHER";

  return (
    <div className="app-wrapper">

      <header className="top-navbar">
        <div className="navbar-inner container">

          <NavLink to="/" className="brand-logo" onClick={() => setMobileMenuOpen(false)}>
            <div className="brand-badge">PTIT</div>
            <div className="brand-titles">
              <span className="brand-name">ExamPro</span>
              <span className="brand-sub">Hệ thống Thi trực tuyến</span>
            </div>
          </NavLink>

          <button
            type="button"
            className="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Mở menu"
          >
            {mobileMenuOpen ? "✕" : "☰"}
          </button>

          <nav className={`nav-links ${mobileMenuOpen ? "open" : ""}`}>
            <NavLink
              to="/"
              end
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              <span>{isTeacher ? "📊" : "📚"}</span>{" "}
              {isTeacher ? "Giám sát & Điểm thi" : "Danh sách đề thi"}
            </NavLink>

            {user?.role === "STUDENT" && (
              <NavLink
                to="/my-results"
                className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <span>📊</span> Lịch sử làm bài
              </NavLink>
            )}

            <NavLink
              to="/chatbot"
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              <span aria-hidden="true">AI</span> Trợ lý học tập
            </NavLink>

            {isTeacher && (
              <>
                <NavLink
                  to="/teacher/questions"
                  className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span>🗂️</span> Kho câu hỏi
                </NavLink>

                <NavLink
                  to="/teacher/exams"
                  className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span>➕</span> Tạo đề thi
                </NavLink>

                <NavLink
                  to="/teacher/history"
                  className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span>🕒</span> Quản lý đề & Nhật ký
                </NavLink>

                <NavLink
                  to="/admin/users"
                  className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span>👥</span> Tài khoản
                </NavLink>
              </>
            )}
          </nav>

          <div className="user-controls">
            <div className="user-profile-pill">
              <div className="user-avatar">
                {user?.fullName ? user.fullName.charAt(0).toUpperCase() : "U"}
              </div>
              <div className="user-meta">
                <span className={`role-tag ${isTeacher ? "teacher" : "student"}`}>
                  {isTeacher
                    ? Number(user?.is_super_admin) === 1
                      ? "👑 Super Admin"
                      : "Admin"
                    : `SV • ${user?.studentCode || "PTIT"}${
                        user?.majorGroup === "KY_THUAT"
                          ? " • Kỹ thuật"
                          : user?.majorGroup === "KINH_TE"
                          ? " • Kinh tế"
                          : ""
                      }`}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: "7px 12px", fontSize: "0.82rem" }}
              onClick={() => {
                setPwdError("");
                setPwdForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
                setShowChangePwdModal(true);
              }}
            >
              🔑 Đổi mật khẩu
            </button>
            <button type="button" className="btn-logout" onClick={handleLogout}>
              Đăng xuất
            </button>
          </div>
        </div>
      </header>

      <main className="main-content container">
        <Outlet />
      </main>

      <footer className="app-footer">
        <div className="container footer-inner">
          <div>
            <strong>HỌC VIỆN CÔNG NGHỆ BƯU CHÍNH VIỄN THÔNG (PTIT)</strong>
            <p>Bài tập lớn Cuối kỳ — Hệ thống Thi Trắc nghiệm Trực tuyến Fullstack (React + Express + MySQL)</p>
          </div>
          <div className="footer-tech-badges">
            <span>React Router v6</span>
            <span>Zustand + Context</span>
            <span>Express REST API</span>
            <span>MySQL 8.0</span>
          </div>
        </div>
      </footer>

      {showChangePwdModal &&
        createPortal(
          <div
            className="bulk-modal-backdrop"
            onClick={() => !pwdSaving && setShowChangePwdModal(false)}
          >
            <div
              className="bulk-modal-card quick-subject-modal-card"
              role="dialog"
              aria-modal="true"
              aria-label="Đổi mật khẩu"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bulk-modal-header">
                <div>
                  <span className="section-badge">BẢO MẬT TÀI KHOẢN</span>
                  <h2>🔑 Đổi mật khẩu</h2>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={pwdSaving}
                  onClick={() => setShowChangePwdModal(false)}
                >
                  ✕ Đóng
                </button>
              </div>

              {pwdError && <div className="alert-box alert-error">⚠️ {pwdError}</div>}

              <form onSubmit={handleChangePasswordSubmit} className="admin-form">
                <div className="form-field">
                  <label>Mật khẩu hiện tại *</label>
                  <input
                    type="password"
                    placeholder="Nhập mật khẩu hiện tại"
                    value={pwdForm.currentPassword}
                    onChange={(e) =>
                      setPwdForm((p) => ({ ...p, currentPassword: e.target.value }))
                    }
                    required
                  />
                </div>

                <div className="form-field">
                  <label>Mật khẩu mới (>= 8 ký tự, chữ hoa, chữ thường, số) *</label>
                  <input
                    type="password"
                    placeholder="Nhập mật khẩu mới"
                    value={pwdForm.newPassword}
                    onChange={(e) =>
                      setPwdForm((p) => ({ ...p, newPassword: e.target.value }))
                    }
                    required
                  />
                </div>

                <div className="form-field">
                  <label>Xác nhận mật khẩu mới *</label>
                  <input
                    type="password"
                    placeholder="Nhập lại mật khẩu mới"
                    value={pwdForm.confirmPassword}
                    onChange={(e) =>
                      setPwdForm((p) => ({ ...p, confirmPassword: e.target.value }))
                    }
                    required
                  />
                </div>

                <div className="bulk-modal-footer">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={pwdSaving}
                    onClick={() => setShowChangePwdModal(false)}
                  >
                    Hủy
                  </button>
                  <button type="submit" className="btn-primary" disabled={pwdSaving}>
                    {pwdSaving ? "Đang lưu..." : "💾 Lưu mật khẩu mới"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
