import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import { MAJOR_GROUP_LABELS } from "../utils/ptitHelper";

function formatDuration(sec) {
  const safe = Math.max(0, Number(sec) || 0);
  const mins = Math.floor(safe / 60);
  const rem = safe % 60;
  return `${mins}p ${rem}s`;
}

function formatTimeOnly(raw) {
  if (!raw) return "—";
  return new Date(raw).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatRankDisplay(rank) {
  if (rank === 1) return "🥇 #1";
  if (rank === 2) return "🥈 #2";
  if (rank === 3) return "🥉 #3";
  return `#${rank}`;
}

export default function AdminExamMonitor() {
  const [overview, setOverview] = useState({
    alwaysOpen: [],
    inProgressWindow: [],
    closed: [],
  });
  const [activeTab, setActiveTab] = useState("ALWAYS_OPEN");
  const [selectedSubjectCode, setSelectedSubjectCode] = useState("");
  const [collapsedSubjects, setCollapsedSubjects] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedExamId, setSelectedExamId] = useState(null);
  const [modalTab, setModalTab] = useState("LEADERBOARD");
  const [leaderboardData, setLeaderboardData] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await axiosClient.get("/exams/admin-overview");
      setOverview(
        res.data?.data || { alwaysOpen: [], inProgressWindow: [], closed: [] }
      );
    } catch (err) {
      setError(
        err.response?.data?.message || "Không thể tải dữ liệu giám sát đề thi."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const openLeaderboardModal = async (examId) => {
    setSelectedExamId(examId);
    setModalTab("LEADERBOARD");
    setModalLoading(true);
    setModalError("");
    setLeaderboardData(null);
    try {
      const res = await axiosClient.get(`/exams/${examId}/leaderboard`);
      setLeaderboardData(res.data?.data || null);
    } catch (err) {
      setModalError(
        err.response?.data?.message || "Không thể tải bảng xếp hạng của đề thi."
      );
    } finally {
      setModalLoading(false);
    }
  };

  const closeLeaderboardModal = () => {
    setSelectedExamId(null);
    setLeaderboardData(null);
    setModalError("");
  };

  const handleExportCsv = () => {
    if (!leaderboardData || !leaderboardData.leaderboard?.length) return;
    const esc = (val) => {
      let str = String(val ?? "");
      if (/^[=+\-@\t\r]/.test(str.trimStart())) {
        str = `'${str}`;
      }
      return `"${str.replace(/"/g, '""')}"`;
    };
    const headers = [
      "Hạng",
      "Đồng hạng",
      "Mã SV",
      "Họ tên",
      "Khối ngành",
      "Điểm số",
      "Số câu đúng",
      "Tổng câu",
      "Thời gian làm (giây)",
      "Giờ bắt đầu",
      "Giờ nộp bài",
      "Số lần thoát tab",
    ];
    const rows = leaderboardData.leaderboard.map((row) => [
      row.rank,
      row.is_tied ? "Có" : "",
      row.student_code || "",
      row.full_name || "",
      MAJOR_GROUP_LABELS[row.major_group] || "",
      Number(row.score).toFixed(2),
      row.correct_count,
      row.total_questions,
      row.time_spent_seconds,
      row.started_at ? new Date(row.started_at).toLocaleString("vi-VN") : "",
      row.submitted_at ? new Date(row.submitted_at).toLocaleString("vi-VN") : "",
      Number(row.tab_switch_count) || 0,
    ]);
    const csvContent =
      "\uFEFF" +
      [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeCode = (leaderboardData.exam?.subject_code || "exam").replace(/\W+/g, "_");
    link.href = url;
    link.download = `BangXepHang_${safeCode}_Exam${leaderboardData.exam?.id || ""}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleReopenExam = async (e, exam) => {
    e.stopPropagation();
    if (!window.confirm(`Mở lại đề thi "${exam.title}" ngay lập tức?`)) return;
    try {
      await axiosClient.patch(`/exams/${exam.id}/reopen`);
      loadOverview();
    } catch (err) {
      alert(err.response?.data?.message || "Không thể mở lại đề thi.");
    }
  };

  const handleSuspendStudent = async (examId, userId, fullName) => {
    const reason = window.prompt(
      `Nhập lý do đình chỉ bài thi (0 điểm) của sinh viên "${fullName}":`,
      "Vi phạm quy chế phòng thi"
    );
    if (reason === null) return;
    try {
      await axiosClient.post("/submissions/suspend", {
        examId,
        userId,
        reason: reason.trim() || "Vi phạm quy chế phòng thi",
      });
      await Promise.all([openLeaderboardModal(examId), loadOverview()]);
    } catch (err) {
      alert(err.response?.data?.message || "Không thể đình chỉ bài thi.");
    }
  };

  const handleUnsuspendStudent = async (examId, userId, fullName) => {
    if (
      !window.confirm(
        `Mở khóa cho sinh viên "${fullName}" làm lại bài thi này từ đầu?`
      )
    ) {
      return;
    }
    try {
      await axiosClient.post("/submissions/unsuspend", { examId, userId });
      await Promise.all([openLeaderboardModal(examId), loadOverview()]);
    } catch (err) {
      alert(err.response?.data?.message || "Không thể mở lại lượt thi.");
    }
  };

  const currentList = useMemo(
    () =>
      activeTab === "ALWAYS_OPEN"
        ? overview.alwaysOpen
        : activeTab === "IN_PROGRESS"
        ? overview.inProgressWindow
        : overview.closed,
    [activeTab, overview]
  );

  const subjectPills = useMemo(() => {
    const map = new Map();
    for (const exam of currentList) {
      const code = exam.subject_code || "OTHER";
      if (!map.has(code)) {
        map.set(code, {
          code,
          name: exam.subject_name || "Khác",
          count: 0,
        });
      }
      map.get(code).count += 1;
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [currentList]);

  const filteredList = useMemo(() => {
    if (!selectedSubjectCode) return currentList;
    return currentList.filter(
      (exam) => (exam.subject_code || "OTHER") === selectedSubjectCode
    );
  }, [currentList, selectedSubjectCode]);

  const groupedCurrentList = useMemo(() => {
    const map = new Map();
    for (const exam of filteredList) {
      const code = exam.subject_code || "OTHER";
      if (!map.has(code)) {
        map.set(code, {
          subjectCode: code,
          subjectName: exam.subject_name || "Khác",
          items: [],
        });
      }
      map.get(code).items.push(exam);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.subjectCode.localeCompare(b.subjectCode)
    );
  }, [filteredList]);

  const toggleSubjectCollapse = (subjectCode) => {
    setCollapsedSubjects((prev) => ({
      ...prev,
      [subjectCode]: !prev[subjectCode],
    }));
  };

  const handleSwitchStatusTab = (tab) => {
    setActiveTab(tab);
    setSelectedSubjectCode("");
  };

  const totalExams =
    overview.alwaysOpen.length +
    overview.inProgressWindow.length +
    overview.closed.length;

  return (
    <div className="page-container">
      {error && (
        <div className="alert-box alert-error">
          ⚠️ {error}{" "}
          <button type="button" className="btn-secondary" onClick={loadOverview}>
            Thử lại
          </button>
        </div>
      )}

      <section className="hero-banner">
        <div className="hero-banner-text">
          <span className="banner-pill">
            🛡️ TRUNG TÂM GIÁM SÁT ĐỀ THI & BẢNG XẾP HẠNG • ADMIN
          </span>
          <h1>Giám sát Đề thi Trực tuyến</h1>
          <p>
            Theo dõi trạng thái làm bài theo thời gian thực, xem thống kê phổ điểm
            và bảng xếp hạng chi tiết của sinh viên cho từng đề thi.
          </p>
        </div>

        <div className="hero-banner-actions">
          <Link to="/teacher/questions" className="btn-glass">
            🗂️ Ngân hàng câu hỏi
          </Link>
          <Link to="/teacher/exams" className="btn-white">
            ➕ Tạo & Quản lý Đề thi
          </Link>
        </div>
      </section>

      <section className="stats-row">
        <div className="stat-box">
          <div className="stat-icon indigo">📚</div>
          <div>
            <span className="stat-label">Tổng số đề thi</span>
            <strong className="stat-value">{totalExams} đề</strong>
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-icon emerald">🟢</div>
          <div>
            <span className="stat-label">Đề trực tuyến (Mở mọi lúc)</span>
            <strong className="stat-value">{overview.alwaysOpen.length} đề</strong>
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-icon amber">🟠</div>
          <div>
            <span className="stat-label">Đề đang trong thời gian làm</span>
            <strong className="stat-value">
              {overview.inProgressWindow.length} đề
            </strong>
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-icon crimson">🔒</div>
          <div>
            <span className="stat-label">Đề đã hoàn thành (Đã đóng)</span>
            <strong className="stat-value">{overview.closed.length} đề</strong>
          </div>
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-header-flex">
          <div className="tab-switcher">
            <button
              type="button"
              className={`tab-btn ${activeTab === "ALWAYS_OPEN" ? "active" : ""}`}
              onClick={() => handleSwitchStatusTab("ALWAYS_OPEN")}
            >
              🟢 Đề trực tuyến ({overview.alwaysOpen.length})
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === "IN_PROGRESS" ? "active" : ""}`}
              onClick={() => handleSwitchStatusTab("IN_PROGRESS")}
            >
              🟠 Đang trong thời gian làm ({overview.inProgressWindow.length})
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === "CLOSED" ? "active" : ""}`}
              onClick={() => handleSwitchStatusTab("CLOSED")}
            >
              🔒 Đã hoàn thành / Đóng ({overview.closed.length})
            </button>
          </div>

          <button
            type="button"
            className="btn-secondary"
            onClick={loadOverview}
            disabled={loading}
          >
            🔄 Làm mới số liệu
          </button>
        </div>

        {subjectPills.length > 0 && (
          <div className="subject-pills-wrap" style={{ marginTop: "14px", marginBottom: "16px" }}>
            <button
              type="button"
              className={`filter-pill ${selectedSubjectCode === "" ? "active" : ""}`}
              onClick={() => setSelectedSubjectCode("")}
            >
              Tất cả ({currentList.length})
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
          <div className="loading-box">Đang tải dữ liệu giám sát đề thi...</div>
        ) : groupedCurrentList.length === 0 ? (
          <div className="empty-box">
            <div className="empty-emoji">📭</div>
            <h3>Không có đề thi nào trong mục này</h3>
            <p>Hãy chuyển sang tab khác hoặc tạo đề thi mới ở trang Quản lý đề thi.</p>
          </div>
        ) : (
          <div className="subject-groups-stack" style={{ marginTop: "12px" }}>
            {groupedCurrentList.map((group) => {
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
                        {group.items.length} đề
                      </span>
                    </div>
                    <span className="subject-group-toggle">
                      {isCollapsed ? "▶ Mở rộng" : "▼ Thu gọn"}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div className="exam-cards-grid" style={{ padding: "16px" }}>
                      {group.items.map((exam) => (
                        <article
                          key={exam.id}
                          className="exam-card"
                          style={{ cursor: "pointer" }}
                          onClick={() => openLeaderboardModal(exam.id)}
                        >
                          <div className="exam-card-top">
                            <span className="subject-badge">
                              {exam.subject_code} • {exam.subject_name}
                            </span>
                            <span
                              className={`major-group-badge ${
                                exam.major_group === "KY_THUAT"
                                  ? "tech"
                                  : exam.major_group === "KINH_TE"
                                  ? "econ"
                                  : "all"
                              }`}
                            >
                              {MAJOR_GROUP_LABELS[exam.major_group] || "Đề chung"}
                            </span>
                          </div>

                          <h3 className="exam-card-title">{exam.title}</h3>
                          {exam.exam_session && (
                            <div style={{ marginBottom: "8px" }}>
                              <span className="code-badge">
                                📅 {exam.exam_session}
                                {exam.exam_shift ? ` - ${exam.exam_shift}` : ""}
                              </span>
                            </div>
                          )}

                          <div className="exam-card-specs">
                            <div className="spec-pill">
                              <span>⏱️ Thời lượng:</span>
                              <strong>{exam.duration_minutes} phút</strong>
                            </div>
                            <div className="spec-pill">
                              <span>📝 Số câu:</span>
                              <strong>{exam.question_count} câu</strong>
                            </div>
                            {Boolean(exam.anti_cheat) && (
                              <span className="tab-switch-badge danger">
                                🛡️ Giám sát Anti-Cheat
                              </span>
                            )}
                          </div>

                          <div className="alert-box" style={{ margin: "10px 0", padding: "10px 12px" }}>
                            {activeTab === "ALWAYS_OPEN" && (
                              <span>
                                👥 Đã có <strong>{exam.completed_count}</strong> sinh viên làm bài
                                {Number(exam.in_progress_count) > 0
                                  ? ` • ⏳ ${exam.in_progress_count} đang thi`
                                  : ""}
                              </span>
                            )}
                            {activeTab === "IN_PROGRESS" && (
                              <span>
                                ⏳ <strong>{exam.in_progress_count}</strong> sinh viên đang làm • ✅{" "}
                                <strong>{exam.completed_count}</strong> sinh viên đã xong
                              </span>
                            )}
                            {activeTab === "CLOSED" && (
                              <span>
                                📊 Tổng cộng <strong>{exam.completed_count}</strong> sinh viên đã hoàn thành
                              </span>
                            )}
                          </div>

                          <div className="exam-card-footer" style={{ display: "flex", gap: "8px" }}>
                            <button
                              type="button"
                              className="btn-enter-exam"
                              style={{ flex: 1, border: "none", cursor: "pointer" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                openLeaderboardModal(exam.id);
                              }}
                            >
                              🏆 Xem chi tiết & Bảng xếp hạng
                            </button>
                            {activeTab === "CLOSED" && (
                              <button
                                type="button"
                                className="btn-sm picker-bank-btn"
                                onClick={(e) => handleReopenExam(e, exam)}
                              >
                                🔓 Mở lại đề
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {selectedExamId &&
        createPortal(
          <div className="bulk-modal-backdrop" onClick={closeLeaderboardModal}>
            <div
              className="bulk-modal-card"
              role="dialog"
              aria-modal="true"
              aria-label="Chi tiết đề thi và Bảng xếp hạng"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bulk-modal-header">
                <div>
                  <span className="section-badge">
                    {leaderboardData?.exam?.subject_code || "BẢNG XẾP HẠNG"}
                  </span>
                  <h2>
                    🏆 {leaderboardData?.exam?.title || "Đang tải thông tin đề thi..."}
                  </h2>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-sm picker-bank-btn"
                    onClick={handleExportCsv}
                    disabled={modalLoading || !leaderboardData?.leaderboard?.length}
                  >
                    📥 Xuất Excel (CSV)
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => openLeaderboardModal(selectedExamId)}
                    disabled={modalLoading}
                  >
                    🔄 Làm mới
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={closeLeaderboardModal}
                  >
                    ✕ Đóng
                  </button>
                </div>
              </div>

              {modalError && (
                <div className="alert-box alert-error">⚠️ {modalError}</div>
              )}

              {modalLoading ? (
                <div className="loading-box">Đang tải bảng xếp hạng...</div>
              ) : (
                leaderboardData && (
                  <>
                    <div className="stats-row" style={{ marginBottom: "4px" }}>
                      <div className="stat-box">
                        <div className="stat-icon amber">⏳</div>
                        <div>
                          <span className="stat-label">Đang làm bài</span>
                          <strong className="stat-value">
                            {leaderboardData.stats.inProgressCount} SV
                          </strong>
                        </div>
                      </div>
                      <div className="stat-box">
                        <div className="stat-icon indigo">✅</div>
                        <div>
                          <span className="stat-label">Đã nộp bài</span>
                          <strong className="stat-value">
                            {leaderboardData.stats.completedCount} lượt
                          </strong>
                        </div>
                      </div>
                      <div className="stat-box">
                        <div className="stat-icon emerald">⭐</div>
                        <div>
                          <span className="stat-label">Điểm trung bình</span>
                          <strong className="stat-value">
                            {leaderboardData.stats.avgScore} / 10
                          </strong>
                        </div>
                      </div>
                      <div className="stat-box">
                        <div className="stat-icon crimson">🎯</div>
                        <div>
                          <span className="stat-label">Tỷ lệ đạt</span>
                          <strong className="stat-value">
                            {leaderboardData.stats.passRate}%
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div className="tab-switcher" style={{ alignSelf: "flex-start" }}>
                      <button
                        type="button"
                        className={`tab-btn ${modalTab === "LEADERBOARD" ? "active" : ""}`}
                        onClick={() => setModalTab("LEADERBOARD")}
                      >
                        🏆 Bảng xếp hạng ({leaderboardData.leaderboard.length})
                      </button>
                      <button
                        type="button"
                        className={`tab-btn ${modalTab === "IN_PROGRESS" ? "active" : ""}`}
                        onClick={() => setModalTab("IN_PROGRESS")}
                      >
                        ⏳ Đang trong phòng thi ({leaderboardData.inProgress.length})
                      </button>
                    </div>

                    <div className="bulk-preview-list" style={{ maxHeight: "52vh" }}>
                      {modalTab === "LEADERBOARD" ? (
                        leaderboardData.leaderboard.length === 0 ? (
                          <div className="bulk-preview-empty">
                            Chưa có sinh viên nào nộp bài cho đề thi này.
                          </div>
                        ) : (
                          <div className="table-responsive">
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>Hạng</th>
                                  <th>Mã SV</th>
                                  <th>Họ tên</th>
                                  <th>Khối ngành</th>
                                  <th>Điểm số</th>
                                  <th>Thời gian làm</th>
                                  <th>Khung giờ nộp</th>
                                  <th>Thoát tab</th>
                                  <th style={{ textAlign: "right" }}>Thao tác</th>
                                </tr>
                              </thead>
                              <tbody>
                                {leaderboardData.leaderboard.map((row) => {
                                  const score = Number(row.score);
                                  const isSuspended = Number(row.is_suspended) === 1;
                                  const tabCount = Number(row.tab_switch_count) || 0;
                                  const tabClass =
                                    tabCount === 0
                                      ? "safe"
                                      : tabCount <= 2
                                      ? "warn"
                                      : "danger";
                                  return (
                                    <tr key={row.submission_id}>
                                      <td>
                                        <strong>{formatRankDisplay(row.rank)}</strong>
                                        {row.is_tied && (
                                          <div className="sub-text" style={{ color: "var(--amber-bright)" }}>
                                            Đồng hạng
                                          </div>
                                        )}
                                      </td>
                                      <td>
                                        <span className="code-badge">
                                          {row.student_code || "SV"}
                                        </span>
                                      </td>
                                      <td>
                                        <strong>{row.full_name}</strong>
                                        {isSuspended && (
                                          <div style={{ marginTop: "4px" }}>
                                            <span
                                              className="tab-switch-badge danger"
                                              title={row.suspend_reason || "Vi phạm quy chế"}
                                            >
                                              🛑 BỊ ĐÌNH CHỈ
                                            </span>
                                            {row.suspend_reason && (
                                              <div className="sub-text" style={{ color: "var(--rose-bright)" }}>
                                                {row.suspend_reason}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </td>
                                      <td>
                                        <span
                                          className={`major-group-badge ${
                                            row.major_group === "KY_THUAT"
                                              ? "tech"
                                              : row.major_group === "KINH_TE"
                                              ? "econ"
                                              : "all"
                                          }`}
                                        >
                                          {MAJOR_GROUP_LABELS[row.major_group] || "—"}
                                        </span>
                                      </td>
                                      <td>
                                        <span
                                          className={`score-pill ${
                                            isSuspended
                                              ? "low"
                                              : score >= 8
                                              ? "high"
                                              : score >= 5
                                              ? "medium"
                                              : "low"
                                          }`}
                                        >
                                          {score.toFixed(2)} đ
                                        </span>
                                      </td>
                                      <td>{formatDuration(row.time_spent_seconds)}</td>
                                      <td>
                                        <div className="time-range-cell">
                                          <span className="time-range-main">
                                            {formatTimeOnly(row.started_at)} →{" "}
                                            {formatTimeOnly(row.submitted_at)}
                                          </span>
                                          <span className="time-range-sub">
                                            {new Date(row.submitted_at).toLocaleDateString("vi-VN")}
                                          </span>
                                        </div>
                                      </td>
                                      <td>
                                        <span className={`tab-switch-badge ${tabClass}`}>
                                          {tabCount} lần
                                        </span>
                                      </td>
                                      <td style={{ textAlign: "right" }}>
                                        {isSuspended ? (
                                          <button
                                            type="button"
                                            className="btn-sm picker-bank-btn"
                                            onClick={() =>
                                              handleUnsuspendStudent(
                                                selectedExamId,
                                                row.student_id,
                                                row.full_name
                                              )
                                            }
                                          >
                                            🔄 Mở khóa cho thi lại
                                          </button>
                                        ) : (
                                          <button
                                            type="button"
                                            className="btn-sm delete"
                                            onClick={() =>
                                              handleSuspendStudent(
                                                selectedExamId,
                                                row.student_id,
                                                row.full_name
                                              )
                                            }
                                          >
                                            🛑 Đình chỉ (0đ)
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )
                      ) : leaderboardData.inProgress.length === 0 ? (
                        <div className="bulk-preview-empty">
                          Hiện không có sinh viên nào đang làm đề thi này.
                        </div>
                      ) : (
                        <div className="table-responsive">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Mã SV</th>
                                <th>Họ tên</th>
                                <th>Khối ngành</th>
                                <th>Giờ bắt đầu vào thi</th>
                                <th>Trạng thái</th>
                                <th style={{ textAlign: "right" }}>Thao tác</th>
                              </tr>
                            </thead>
                            <tbody>
                              {leaderboardData.inProgress.map((item) => (
                                <tr key={item.id}>
                                  <td>
                                    <span className="code-badge">
                                      {item.student_code || "SV"}
                                    </span>
                                  </td>
                                  <td>
                                    <strong>{item.full_name}</strong>
                                  </td>
                                  <td>
                                    <span
                                      className={`major-group-badge ${
                                        item.major_group === "KY_THUAT"
                                          ? "tech"
                                          : item.major_group === "KINH_TE"
                                          ? "econ"
                                          : "all"
                                      }`}
                                    >
                                      {MAJOR_GROUP_LABELS[item.major_group] || "—"}
                                    </span>
                                  </td>
                                  <td>
                                    {new Date(item.started_at).toLocaleString("vi-VN")}
                                  </td>
                                  <td>
                                    <span className="tab-switch-badge warn">
                                      ⏳ Đang làm bài
                                    </span>
                                  </td>
                                  <td style={{ textAlign: "right" }}>
                                    <button
                                      type="button"
                                      className="btn-sm delete"
                                      onClick={() =>
                                        handleSuspendStudent(
                                          selectedExamId,
                                          item.user_id,
                                          item.full_name
                                        )
                                      }
                                    >
                                      🛑 Đình chỉ (0đ)
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                )
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
