import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../../api/axiosClient";
import { useAuth } from "../../context/AuthContext";
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
  const { user } = useAuth();
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
      setCreatedTempAdmin(res.data?.data || null);
      setAdminForm({ fullName: "", email: "", superAdminPassword: "" });
      setNotice({
        type: "success",
        text: `✅ ${res.data?.message || "Đã tạo Admin mới thành công!"}`,
      });
      loadData();
    } catch (err) {
      setNotice({
        type: "error",
        text: err.response?.data?.message || "Không thể tạo tài khoản Admin mới.",
      });
    } finally {
      setCreatingAdmin(false);
    }
  };

  const handleRevokeAdmin = async (adm) => {
    if (
      !window.confirm(
        `Thu hồi quyền Admin của "${adm.full_name}" (${adm.email})? Mọi phiên đăng nhập của người này sẽ bị đăng xuất ngay lập tức.`
      )
    ) {
      return;
    }
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
                            <button
                              type="button"
                              className="btn-sm delete"
                              onClick={() => handleRevokeAdmin(adm)}
                            >
                              Thu hồi quyền
                            </button>
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
