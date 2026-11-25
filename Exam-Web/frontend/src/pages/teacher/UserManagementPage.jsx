import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axiosClient from "../../api/axiosClient";
import { useAuth } from "../../context/AuthContext";
import { useDialog } from "../../context/DialogContext";
import { MAJOR_GROUP_LABELS } from "../../utils/ptitHelper";

function formatDateTime(raw) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  const time = d.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const date = d.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `${time} - ${date}`;
}

export default function UserManagementPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { showToast, confirmDialog } = useDialog();
  const isSuperAdmin = Number(user?.is_super_admin) === 1;

  const [activeTab, setActiveTab] = useState("STUDENTS");
  const [students, setStudents] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState({ type: "", text: "" });

  const [studentSearch, setStudentSearch] = useState("");
  const [studentFilter, setStudentFilter] = useState("ALL");
  const [unlockIdentifier, setUnlockIdentifier] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const [adminForm, setAdminForm] = useState({
    fullName: "",
    email: "",
    superAdminPassword: "",
  });
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [createdTempAdmin, setCreatedTempAdmin] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const requests = [axiosClient.get("/auth/students")];
      if (isSuperAdmin) {
        requests.push(axiosClient.get("/auth/admins"));
      }
      const [stuRes, admRes] = await Promise.all(requests);
      setStudents(stuRes.data?.data || []);
      if (admRes) {
        setAdmins(admRes.data?.data || []);
      }
    } catch (err) {
      setNotice({
        type: "error",
        text: err.response?.data?.message || "Không thể tải dữ liệu tài khoản.",
      });
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const lockedStudentsCount = useMemo(
    () => students.filter((s) => Boolean(s.is_locked)).length,
    [students]
  );

  const filteredStudents = useMemo(() => {
    const kw = studentSearch.trim().toLowerCase();
    return students.filter((s) => {
      if (studentFilter === "LOCKED" && !s.is_locked) return false;
      if (kw) {
        const matchName = s.full_name?.toLowerCase().includes(kw);
        const matchEmail = s.email?.toLowerCase().includes(kw);
        const matchCode = s.student_code?.toLowerCase().includes(kw);
        if (!matchName && !matchEmail && !matchCode) return false;
      }
      return true;
    });
  }, [students, studentFilter, studentSearch]);

  const handleUnlockByIdentifier = async (identifier) => {
    if (!identifier.trim() || unlocking) return;
    setNotice({ type: "", text: "" });
    setUnlocking(true);
    try {
      const res = await axiosClient.patch("/auth/unlock-user", {
        identifier: identifier.trim(),
      });
      setNotice({
        type: "success",
        text: `🔓 ${res.data?.message || "Đã mở khóa tài khoản thành công!"}`,
      });
      setUnlockIdentifier("");
      loadData();
    } catch (err) {
      setNotice({
        type: "error",
        text: err.response?.data?.message || "Không thể mở khóa tài khoản.",
      });
    } finally {
      setUnlocking(false);
    }
  };

  const handleUnlockFormSubmit = async (e) => {
    e.preventDefault();
    await handleUnlockByIdentifier(unlockIdentifier);
  };

  const handleCreateAdmin = async (e) => {
    e.preventDefault();
    if (creatingAdmin) return;
    setNotice({ type: "", text: "" });
    setCreatedTempAdmin(null);
    setCreatingAdmin(true);
    try {
      const res = await axiosClient.post("/auth/admins", adminForm);
      if (res.data?.data?.tempPassword) {
        setCreatedTempAdmin(res.data.data);
      }
      setAdminForm({ fullName: "", email: "", superAdminPassword: "" });
      showToast(res.data?.message || "Đã tạo Admin mới thành công!", "success");
      loadData();
    } catch (err) {
      const errData = err.response?.data;
      if (err.response?.status === 409 && errData?.requirePromoteConfirm) {
        setCreatingAdmin(false);
        const ok = await confirmDialog({
          title: "Xác nhận nâng cấp tài khoản Sinh viên",
          message: `Email ${errData.email} hiện đang thuộc về tài khoản Sinh viên ${errData.studentName}. Bạn có muốn nâng cấp tài khoản này lên Quản trị viên (giữ nguyên mật khẩu hiện tại) không?`,
          confirmText: "Xác nhận nâng cấp",
        });
        if (!ok) return;
        setCreatingAdmin(true);
        try {
          const promoteRes = await axiosClient.post("/auth/admins", {
            ...adminForm,
            confirmPromote: true,
          });
          setAdminForm({ fullName: "", email: "", superAdminPassword: "" });
          showToast(
            promoteRes.data?.message || "Đã nâng cấp lên Quản trị viên thành công!",
            "success"
          );
          loadData();
        } catch (promoteErr) {
          const promoteMsg =
            promoteErr.response?.data?.message || "Không thể nâng cấp tài khoản.";
          showToast(promoteMsg, "error");
          setNotice({ type: "error", text: promoteMsg });
        } finally {
          setCreatingAdmin(false);
        }
        return;
      }

      const msg = errData?.message || "Không thể tạo tài khoản Admin mới.";
      if (errData?.forceLogout) {
        showToast(msg, "error");
        await logout();
        navigate("/login", { replace: true });
        return;
      }
      showToast(msg, "error");
      setNotice({ type: "error", text: msg });
    } finally {
      setCreatingAdmin(false);
    }
  };

  const handleDeleteAdmin = async (adm) => {
    const ok = await confirmDialog({
      title: "Xóa tài khoản Admin",
      message: `Bạn chắc chắn muốn xóa vĩnh viễn tài khoản Admin "${adm.full_name}" (${adm.email})?`,
      confirmText: "🗑️ Xóa Admin",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const res = await axiosClient.delete(`/users/${adm.id}`);
      showToast(res.data?.message || "Đã xóa tài khoản Admin!", "success");
      loadData();
    } catch (err) {
      showToast(err.response?.data?.message || "Không thể xóa tài khoản Admin.", "error");
    }
  };

  const handleApproveFirstLogin = async (adm) => {
    try {
      const res = await axiosClient.patch(`/auth/admins/${adm.id}/approve-first-login`);
      showToast(res.data?.message || "Đã phê duyệt đăng nhập lần đầu!", "success");
      loadData();
    } catch (err) {
      showToast(err.response?.data?.message || "Không thể phê duyệt.", "error");
    }
  };

  const handleRejectFirstLogin = async (adm) => {
    try {
      const res = await axiosClient.patch(`/auth/admins/${adm.id}/reject-first-login`);
      showToast(res.data?.message || "Đã từ chối yêu cầu đăng nhập.", "warning");
      loadData();
    } catch (err) {
      showToast(err.response?.data?.message || "Không thể từ chối.", "error");
    }
  };

  const pendingFirstLoginAdmins = useMemo(
    () => admins.filter((a) => Number(a.pending_first_login) === 1 && Number(a.first_login_approved) === 0),
    [admins]
  );

  useEffect(() => {
    if (!isSuperAdmin || activeTab !== "ADMINS") return;
    const timer = setInterval(() => {
      loadData();
    }, 5000);
    return () => clearInterval(timer);
  }, [isSuperAdmin, activeTab, loadData]);

  const handleRevokeAdmin = async (adm) => {
    const ok = await confirmDialog({
      title: "Thu hồi quyền Admin",
      message: `Thu hồi quyền Admin của "${adm.full_name}" (${adm.email})? Mọi phiên đăng nhập của người này sẽ bị đăng xuất ngay lập tức.`,
      confirmText: "Thu hồi quyền",
      tone: "danger",
    });
    if (!ok) return;
    setNotice({ type: "", text: "" });
    try {
      const res = await axiosClient.patch(`/auth/admins/${adm.id}/revoke`);
      setNotice({
        type: "success",
        text: `✅ ${res.data?.message || "Đã thu hồi quyền Admin!"}`,
      });
      loadData();
    } catch (err) {
      setNotice({
        type: "error",
        text: err.response?.data?.message || "Không thể thu hồi quyền Admin.",
      });
    }
  };

  return (
    <div className="page-container">
      <div className="page-header-block">
        <div>
          <span className="section-badge">QUẢN LÝ NGƯỜI DÙNG & PHÂN QUYỀN</span>
          <h1>Quản lý Tài khoản Hệ thống</h1>
          <p>
            Theo dõi trạng thái tài khoản sinh viên, mở khóa nhanh và quản lý đội ngũ quản trị viên.
          </p>
        </div>

        <div className="tab-switcher">
          <button
            type="button"
            className={`tab-btn ${activeTab === "STUDENTS" ? "active" : ""}`}
            onClick={() => setActiveTab("STUDENTS")}
          >
            👥 Sinh viên ({students.length}
            {lockedStudentsCount > 0 ? ` • 🔒 ${lockedStudentsCount}` : ""})
          </button>
          {isSuperAdmin && (
            <button
              type="button"
              className={`tab-btn ${activeTab === "ADMINS" ? "active" : ""}`}
              onClick={() => setActiveTab("ADMINS")}
            >
              🛡️ Đội ngũ Admin ({admins.length})
              {pendingFirstLoginAdmins.length > 0 && (
                <span
                  style={{
                    marginLeft: "6px",
                    padding: "2px 7px",
                    borderRadius: "999px",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    background: "#ef4444",
                    color: "#ffffff",
                  }}
                  title="Admin đang chờ phê duyệt lần đăng nhập đầu tiên"
                >
                  {pendingFirstLoginAdmins.length}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {notice.text && (
        <div
          className={`alert-box ${
            notice.type === "error" ? "alert-error" : "alert-success"
          }`}
        >
          {notice.text}
        </div>
      )}

      {activeTab === "STUDENTS" ? (
        <>
          <section className="panel-card compact-panel-card" style={{ marginBottom: "16px" }}>
            <form
              onSubmit={handleUnlockFormSubmit}
              style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}
            >
              <strong style={{ fontSize: "0.9rem" }}>🔓 Mở khóa tài khoản SV bị khóa:</strong>
              <input
                type="text"
                placeholder="Nhập Email hoặc Mã sinh viên (VD: B22DCCN001)..."
                value={unlockIdentifier}
                onChange={(e) => setUnlockIdentifier(e.target.value)}
                style={{
                  flex: "1 1 260px",
                  padding: "8px 12px",
                  borderRadius: "10px",
                  border: "1px solid var(--border-color)",
                  background: "var(--bg-surface-subtle)",
                  color: "var(--text-main)",
                }}
              />
              <button
                type="submit"
                className="btn-secondary"
                disabled={unlocking || !unlockIdentifier.trim()}
              >
                {unlocking ? "Đang mở khóa..." : "🔓 Mở khóa ngay"}
              </button>
            </form>
          </section>

          <section className="panel-card">
            <div className="panel-header-flex">
              <div>
                <h2>Danh sách Sinh viên ({filteredStudents.length})</h2>
                <div className="sub-text">
                  Đang bị khóa: <strong>{lockedStudentsCount}</strong> tài khoản
                </div>
              </div>
              <div className="inline-filters">
                <div className="tab-switcher">
                  <button
                    type="button"
                    className={`tab-btn ${studentFilter === "ALL" ? "active" : ""}`}
                    onClick={() => setStudentFilter("ALL")}
                  >
                    Tất cả ({students.length})
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${studentFilter === "LOCKED" ? "active" : ""}`}
                    onClick={() => setStudentFilter("LOCKED")}
                  >
                    🔒 Đang bị khóa ({lockedStudentsCount})
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="🔍 Tìm tên, email hoặc MSV..."
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                />
              </div>
            </div>

            {loading ? (
              <div className="loading-box">Đang tải danh sách sinh viên...</div>
            ) : filteredStudents.length === 0 ? (
              <div className="empty-box">
                <div className="empty-emoji">👥</div>
                <h3>
                  {studentFilter === "LOCKED"
                    ? "Hiện không có sinh viên nào bị khóa tài khoản"
                    : "Không tìm thấy sinh viên phù hợp"}
                </h3>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Mã SV</th>
                      <th>Họ tên & Email</th>
                      <th>Khối ngành</th>
                      <th>Số bài đã thi</th>
                      <th>Trạng thái tài khoản</th>
                      <th style={{ textAlign: "right" }}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((stu) => {
                      const isLocked = Boolean(stu.is_locked);
                      return (
                        <tr key={stu.id}>
                          <td>
                            <span className="code-badge">{stu.student_code || "SV"}</span>
                          </td>
                          <td>
                            <strong>{stu.full_name}</strong>
                            <div className="sub-text">{stu.email}</div>
                          </td>
                          <td>
                            <span
                              className={`major-group-badge ${
                                stu.major_group === "KY_THUAT"
                                  ? "tech"
                                  : stu.major_group === "KINH_TE"
                                  ? "econ"
                                  : "all"
                              }`}
                            >
                              {MAJOR_GROUP_LABELS[stu.major_group] || "—"}
                            </span>
                          </td>
                          <td>{stu.submission_count} lượt</td>
                          <td>
                            {isLocked ? (
                              <div>
                                <span className="tab-switch-badge danger">
                                  🔒 Đang bị khóa
                                </span>
                                <div className="sub-text">
                                  Đến: {formatDateTime(stu.locked_until)} (sai{" "}
                                  {stu.failed_login_attempts} lần)
                                </div>
                              </div>
                            ) : (
                              <span className="tab-switch-badge safe">
                                🟢 Bình thường
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {isLocked ? (
                              <button
                                type="button"
                                className="btn-sm picker-bank-btn"
                                disabled={unlocking}
                                onClick={() => handleUnlockByIdentifier(stu.email)}
                              >
                                🔓 Mở khóa ngay
                              </button>
                            ) : (
                              <span className="sub-text">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : isSuperAdmin ? (
        <>
          <section className="panel-card compact-panel-card" style={{ marginBottom: "16px" }}>
            <div className="panel-header">
              <h2>➕ Thêm tài khoản Admin mới (Chỉ Super Admin)</h2>
            </div>

            {createdTempAdmin && (
              <div className="alert-box alert-success notice-with-action" style={{ marginBottom: "14px" }}>
                <div>
                  <strong>🎉 Đã tạo Admin: {createdTempAdmin.fullName}</strong> ({createdTempAdmin.email})
                  <div style={{ marginTop: "4px" }}>
                    Mật khẩu tạm (chỉ hiển thị 1 lần):{" "}
                    <code className="code-badge" style={{ fontSize: "0.95rem" }}>
                      {createdTempAdmin.tempPassword}
                    </code>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-sm edit"
                  onClick={() => {
                    navigator.clipboard?.writeText(createdTempAdmin.tempPassword);
                    setNotice({ type: "success", text: "📋 Đã sao chép mật khẩu tạm vào bộ nhớ tạm!" });
                  }}
                >
                  📋 Copy mật khẩu tạm
                </button>
              </div>
            )}

            <form onSubmit={handleCreateAdmin} className="admin-form compact-admin-form">
              <div className="form-row-3">
                <div className="form-field">
                  <label>Họ và tên Admin mới *</label>
                  <input
                    type="text"
                    placeholder="VD: Nguyễn Văn B"
                    value={adminForm.fullName}
                    onChange={(e) =>
                      setAdminForm((p) => ({ ...p, fullName: e.target.value }))
                    }
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Email đăng nhập *</label>
                  <input
                    type="email"
                    placeholder="VD: admin2@gmail.com"
                    value={adminForm.email}
                    onChange={(e) =>
                      setAdminForm((p) => ({ ...p, email: e.target.value }))
                    }
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Xác nhận mật khẩu Super Admin *</label>
                  <input
                    type="password"
                    placeholder="Nhập mật khẩu của bạn..."
                    value={adminForm.superAdminPassword}
                    onChange={(e) =>
                      setAdminForm((p) => ({
                        ...p,
                        superAdminPassword: e.target.value,
                      }))
                    }
                    required
                  />
                </div>
              </div>
              <div className="form-actions-right">
                <button type="submit" className="btn-primary" disabled={creatingAdmin}>
                  {creatingAdmin ? "Đang tạo..." : "🛡️ Cấp quyền Admin mới"}
                </button>
              </div>
            </form>
          </section>

          {pendingFirstLoginAdmins.length > 0 && (
            <section className="panel-card compact-panel-card" style={{ marginBottom: "16px", borderColor: "rgba(251, 191, 36, 0.5)" }}>
              <div className="panel-header">
                <h2>🔔 Xác nhận cho phép Admin đăng nhập lần đầu ({pendingFirstLoginAdmins.length})</h2>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {pendingFirstLoginAdmins.map((adm) => (
                  <div
                    key={adm.id}
                    className="zalo-appeal-box"
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}
                  >
                    <div>
                      <strong style={{ color: "#ffffff" }}>{adm.full_name}</strong>{" "}
                      <span style={{ color: "#7dd3fc" }}>({adm.email})</span>
                      <div className="sub-text">Đã xác thực OTP thành công và đang chờ bạn cho phép vào hệ thống.</div>
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        className="btn-sm picker-bank-btn"
                        onClick={() => handleApproveFirstLogin(adm)}
                      >
                        ✅ Cho phép vào
                      </button>
                      <button
                        type="button"
                        className="btn-sm delete"
                        onClick={() => handleRejectFirstLogin(adm)}
                      >
                        ❌ Từ chối
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="panel-card">
            <div className="panel-header">
              <h2>🛡️ Danh sách Đội ngũ Admin ({admins.length})</h2>
            </div>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Họ tên</th>
                    <th>Email</th>
                    <th>Cấp bậc</th>
                    <th>Ngày tạo</th>
                    <th style={{ textAlign: "right" }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map((adm) => {
                    const isRoot = Number(adm.is_super_admin) === 1;
                    return (
                      <tr key={adm.id}>
                        <td>
                          <strong>{adm.full_name}</strong>
                        </td>
                        <td>{adm.email}</td>
                        <td>
                          {isRoot ? (
                            <span className="tab-switch-badge warn">👑 Super Admin</span>
                          ) : (
                            <span className="tab-switch-badge safe">🛡️ Admin</span>
                          )}
                        </td>
                        <td>{formatDateTime(adm.created_at)}</td>
                        <td style={{ textAlign: "right" }}>
                          {isRoot ? (
                            <span className="sub-text">Tài khoản gốc</span>
                          ) : (
                            <div style={{ display: "inline-flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                              <button
                                type="button"
                                className="btn-sm edit"
                                onClick={() => handleRevokeAdmin(adm)}
                              >
                                Thu hồi quyền
                              </button>
                              <button
                                type="button"
                                className="btn-sm delete"
                                onClick={() => handleDeleteAdmin(adm)}
                              >
                                🗑️ Xóa Admin
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
