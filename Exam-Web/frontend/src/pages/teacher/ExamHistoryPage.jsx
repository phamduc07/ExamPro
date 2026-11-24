import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axiosClient from "../../api/axiosClient";
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

const ACTION_BADGE_MAP = {
  CREATE_EXAM: { label: "🟢 Thêm đề mới", cls: "safe" },
  UPDATE_EXAM: { label: "🟡 Sửa đề thi", cls: "warn" },
  REOPEN_EXAM: { label: "🔵 Mở lại đề", cls: "info" },
  DELETE_EXAM: { label: "🔴 Xóa đề thi", cls: "danger" },
  UPDATE_QUESTION_REGRADE: { label: "🟣 Sửa câu & Chấm lại", cls: "warn" },
  DELETE_SUBMISSION: { label: "🔴 Xóa bài nộp SV", cls: "danger" },
  CREATE_ADMIN: { label: "👑 Thêm Admin mới", cls: "safe" },
  REVOKE_ADMIN: { label: "🔴 Thu hồi quyền Admin", cls: "danger" },
  SUSPEND_SUBMISSION: { label: "🛑 Đình chỉ bài thi (0đ)", cls: "danger" },
  UNSUSPEND_SUBMISSION: { label: "🔄 Mở lại lượt thi SV", cls: "info" },
};

export default function ExamHistoryPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("EXAMS");
  const [exams, setExams] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState({ type: "", text: "" });

  const [selectedSubjectCode, setSelectedSubjectCode] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedSubjects, setCollapsedSubjects] = useState({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [exRes, logRes] = await Promise.all([
        axiosClient.get("/exams"),
        axiosClient.get("/exams/admin-logs"),
      ]);
      setExams(exRes.data?.data || []);
      setLogs(logRes.data?.data || []);
    } catch (err) {
      setNotice({
        type: "error",
        text: err.response?.data?.message || "Không thể tải lịch sử tạo đề và nhật ký.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const subjectPills = useMemo(() => {
    const map = new Map();
    for (const ex of exams) {
      const code = ex.subject_code || "OTHER";
      if (!map.has(code)) {
        map.set(code, { code, name: ex.subject_name || "Khác", count: 0 });
      }
      map.get(code).count += 1;
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [exams]);

  const filteredExams = useMemo(() => {
    const kw = searchQuery.trim().toLowerCase();
    return exams.filter((ex) => {
      if (selectedSubjectCode && (ex.subject_code || "OTHER") !== selectedSubjectCode) {
        return false;
      }
      if (kw) {
        const matchTitle = ex.title?.toLowerCase().includes(kw);
        const matchCode = ex.subject_code?.toLowerCase().includes(kw);
        const matchName = ex.subject_name?.toLowerCase().includes(kw);
        if (!matchTitle && !matchCode && !matchName) return false;
      }
      return true;
    });
  }, [exams, selectedSubjectCode, searchQuery]);

  const groupedExams = useMemo(() => {
    const map = new Map();
    for (const ex of filteredExams) {
      const code = ex.subject_code || "OTHER";
      if (!map.has(code)) {
        map.set(code, {
          subjectCode: code,
          subjectName: ex.subject_name || "Khác",
          items: [],
        });
      }
      map.get(code).items.push(ex);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.subjectCode.localeCompare(b.subjectCode)
    );
  }, [filteredExams]);

  const toggleSubjectCollapse = (subjectCode) => {
    setCollapsedSubjects((prev) => ({
      ...prev,
      [subjectCode]: !prev[subjectCode],
    }));
  };

  const handleReopenExam = async (exam) => {
    if (!window.confirm(`Mở lại đề thi "${exam.title}" ngay lập tức?`)) return;
    setNotice({ type: "", text: "" });
    try {
      const res = await axiosClient.patch(`/exams/${exam.id}/reopen`);
      setNotice({
        type: "success",
        text: `🔓 ${res.data?.message || "Đã mở lại đề thi thành công!"}`,
      });
      loadData();
    } catch (err) {
      setNotice({
        type: "error",
        text: err.response?.data?.message || "Không thể mở lại đề thi.",
      });
    }
  };

  const handleDeleteExam = async (exam) => {
    if (!window.confirm(`Bạn chắc chắn muốn xóa đề thi "${exam.title}"?`)) return;
    setNotice({ type: "", text: "" });
    try {
      await axiosClient.delete(`/exams/${exam.id}`);
      setNotice({ type: "success", text: "🗑️ Đã xóa đề thi thành công!" });
      loadData();
    } catch (err) {
      setNotice({
        type: "error",
        text: err.response?.data?.message || "Không thể xóa đề thi.",
      });
    }
  };

  return (
    <div className="page-container">
      <div className="page-header-block">
        <div>
          <span className="section-badge">QUẢN TRỊ & KIỂM SOÁT THAY ĐỔI</span>
          <h1>Lịch sử tạo Đề thi & Nhật ký Admin</h1>
          <p>
            Quản lý toàn bộ đề thi đã xuất bản (Sửa, Nhân bản, Mở lại, Xóa) và theo dõi nhật ký thao tác của Admin.
          </p>
        </div>

        <div className="tab-switcher">
          <button
            type="button"
            className={`tab-btn ${activeTab === "EXAMS" ? "active" : ""}`}
            onClick={() => setActiveTab("EXAMS")}
          >
            📋 Đề thi đã tạo ({exams.length})
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "LOGS" ? "active" : ""}`}
            onClick={() => setActiveTab("LOGS")}
          >
            🕒 Nhật ký thao tác ({logs.length})
          </button>
          <Link to="/teacher/exams" className="btn-primary">
            ➕ Tạo đề mới
          </Link>
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

      {activeTab === "EXAMS" ? (
        <section className="panel-card">
          <div className="panel-header-flex">
            <h2>Danh sách Đề thi đã tạo ({filteredExams.length})</h2>
            <div className="inline-filters">
              <input
                type="text"
                placeholder="🔍 Tìm theo tên đề hoặc mã môn..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={loadData}
                disabled={loading}
              >
                🔄 Làm mới
              </button>
            </div>
          </div>

          {subjectPills.length > 0 && (
            <div className="subject-pills-wrap" style={{ marginBottom: "16px" }}>
              <button
                type="button"
                className={`filter-pill ${selectedSubjectCode === "" ? "active" : ""}`}
                onClick={() => setSelectedSubjectCode("")}
              >
                Tất cả ({exams.length})
              </button>
              {subjectPills.map((sub) => (
                <button
                  key={sub.code}
                  type="button"
                  className={`filter-pill ${
                    selectedSubjectCode === sub.code ? "active" : ""
                  }`}
                  onClick={() => setSelectedSubjectCode(sub.code)}
                >
                  {sub.code} - {sub.name} ({sub.count})
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="loading-box">Đang tải danh sách đề thi...</div>
          ) : groupedExams.length === 0 ? (
            <div className="empty-box">
              <div className="empty-emoji">📭</div>
              <h3>Chưa có đề thi phù hợp</h3>
              <p>Hãy bấm "Tạo đề mới" hoặc thử thay đổi bộ lọc.</p>
            </div>
          ) : (
            <div className="subject-groups-stack">
              {groupedExams.map((group) => {
                const isCollapsed = Boolean(collapsedSubjects[group.subjectCode]);
                return (
                  <div key={group.subjectCode} className="subject-group-block">
                    <button
                      type="button"
                      className="subject-group-header"
                      onClick={() => toggleSubjectCollapse(group.subjectCode)}
                    >
                      <div className="subject-group-title">
                        <span className="code-badge">{group.subjectCode}</span>
                        <strong>{group.subjectName}</strong>
                        <span className="subject-group-count">
                          {group.items.length} đề thi
                        </span>
                      </div>
                      <span className="subject-group-toggle">
                        {isCollapsed ? "▶ Mở rộng" : "▼ Thu gọn"}
                      </span>
                    </button>

                    {!isCollapsed && (
                      <div className="table-responsive">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Tên đề thi</th>
                              <th>Thời gian tạo</th>
                              <th>Cập nhật lần cuối</th>
                              <th>Lượt thi</th>
                              <th>Trạng thái</th>
                              <th style={{ textAlign: "right" }}>Thao tác</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.items.map((ex) => {
                              const isClosed =
                                !ex.is_published ||
                                (ex.close_at && new Date(ex.close_at) < new Date());
                              return (
                                <tr key={ex.id}>
                                  <td>
                                    <strong>{ex.title}</strong>
                                    {ex.exam_session && (
                                      <div style={{ marginTop: "4px" }}>
                                        <span className="code-badge">
                                          📅 {ex.exam_session}
                                          {ex.exam_shift ? ` - ${ex.exam_shift}` : ""}
                                        </span>
                                      </div>
                                    )}
                                    <div className="sub-text">
                                      {ex.duration_minutes} phút • {ex.question_count} câu •{" "}
                                      {MAJOR_GROUP_LABELS[ex.major_group] || "Đề chung"}
                                    </div>
                                  </td>
                                  <td>{formatDateTime(ex.created_at)}</td>
                                  <td>{formatDateTime(ex.updated_at || ex.created_at)}</td>
                                  <td>{ex.submission_count} lượt</td>
                                  <td>
                                    <span
                                      className={`status-tag ${isClosed ? "draft" : "pass"}`}
                                    >
                                      {isClosed ? "Đã đóng" : "Đang mở"}
                                    </span>
                                  </td>
                                  <td style={{ textAlign: "right" }}>
                                    <div className="action-btn-group">
                                      <button
                                        type="button"
                                        className="btn-sm edit"
                                        onClick={() =>
                                          navigate(`/teacher/exams?editId=${ex.id}`)
                                        }
                                      >
                                        ✏️ Sửa đề
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-sm edit"
                                        onClick={() =>
                                          navigate(`/teacher/exams?duplicateId=${ex.id}`)
                                        }
                                      >
                                        📋 Nhân bản
                                      </button>
                                      {isClosed && (
                                        <button
                                          type="button"
                                          className="btn-sm picker-bank-btn"
                                          onClick={() => handleReopenExam(ex)}
                                        >
                                          🔓 Mở lại đề
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="btn-sm delete"
                                        onClick={() => handleDeleteExam(ex)}
                                      >
                                        🗑️ Xóa
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="panel-card">
          <div className="panel-header-flex">
            <h2>Nhật ký thao tác của Admin (Audit Log)</h2>
            <button
              type="button"
              className="btn-secondary"
              onClick={loadData}
              disabled={loading}
            >
              🔄 Làm mới nhật ký
            </button>
          </div>

          {loading ? (
            <div className="loading-box">Đang tải nhật ký thao tác...</div>
          ) : logs.length === 0 ? (
            <div className="empty-box">
              <div className="empty-emoji">🕒</div>
              <h3>Chưa có nhật ký thao tác nào</h3>
              <p>Mọi thao tác Tạo, Sửa, Mở lại hoặc Xóa đề thi sẽ được tự động ghi lại tại đây.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Thời gian thao tác</th>
                    <th>Hành động</th>
                    <th>Mã môn</th>
                    <th>Tên đề thi</th>
                    <th>Chi tiết thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const badge = ACTION_BADGE_MAP[log.action_type] || {
                      label: log.action_type,
                      cls: "warn",
                    };
                    return (
                      <tr key={log.id}>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {formatDateTime(log.created_at)}
                        </td>
                        <td>
                          <span
                            className={`tab-switch-badge ${
                              badge.cls === "info" ? "safe" : badge.cls
                            }`}
                            style={
                              badge.cls === "info"
                                ? {
                                    background: "rgba(56, 189, 248, 0.16)",
                                    color: "#7dd3fc",
                                    border: "1px solid rgba(56, 189, 248, 0.4)",
                                  }
                                : undefined
                            }
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td>
                          <span className="code-badge">{log.subject_code || "—"}</span>
                        </td>
                        <td>
                          <strong>{log.exam_title}</strong>
                          <div className="sub-text">Bởi: {log.admin_name}</div>
                        </td>
                        <td>{log.details || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
