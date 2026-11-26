import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axiosClient from "../../api/axiosClient";
import { ZaloAppealBox } from "../../context/DialogContext";

function formatDuration(sec) {
  const safe = Math.max(0, Number(sec) || 0);
  const mins = Math.floor(safe / 60);
  const rem = safe % 60;
  return `${mins}p ${rem}s`;
}

function formatTimeOnly(date) {
  return date.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDateOnly(date) {
  return date.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function resolveTimeRange(item) {
  const endDate = new Date(item.submitted_at);
  const startDate = item.started_at
    ? new Date(item.started_at)
    : new Date(endDate.getTime() - (Number(item.time_spent_seconds) || 0) * 1000);

  return {
    startText: formatTimeOnly(startDate),
    endText: formatTimeOnly(endDate),
    dateText: formatDateOnly(endDate),
  };
}

export default function MyResultsPage() {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSubjectCode, setSelectedSubjectCode] = useState("");
  const [collapsedSubjects, setCollapsedSubjects] = useState({});

  useEffect(() => {
    axiosClient
      .get("/submissions/my-history")
      .then((res) => {
        setSubmissions(res.data.data || []);
      })
      .catch((err) => {
        setError(
          err.response?.data?.message ||
            "Không thể tải lịch sử. Vui lòng kiểm tra kết nối và tải lại trang."
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const subjectCategories = useMemo(() => {
    const map = new Map();
    for (const item of submissions) {
      const key = item.subject_code || "OTHER";
      if (!map.has(key)) {
        map.set(key, {
          code: key,
          name: item.subject_name || "Khác",
          count: 0,
        });
      }
      map.get(key).count += 1;
    }
    return Array.from(map.values());
  }, [submissions]);

  const filteredSubmissions = useMemo(() => {
    if (!selectedSubjectCode) return submissions;
    return submissions.filter(
      (item) => (item.subject_code || "OTHER") === selectedSubjectCode
    );
  }, [submissions, selectedSubjectCode]);

  const groupedSubmissions = useMemo(() => {
    const groups = new Map();
    for (const item of filteredSubmissions) {
      const key = item.subject_code || "OTHER";
      if (!groups.has(key)) {
        groups.set(key, {
          subjectCode: key,
          subjectName: item.subject_name || "Khác",
          items: [],
        });
      }
      groups.get(key).items.push(item);
    }
    return Array.from(groups.values());
  }, [filteredSubmissions]);

  const toggleSubjectCollapse = (subjectCode) => {
    setCollapsedSubjects((prev) => ({
      ...prev,
      [subjectCode]: !prev[subjectCode],
    }));
  };

  const totalTaken = submissions.length;
  const passedCount = submissions.filter(
    (s) =>
      Number(s.is_suspended) !== 1 &&
      !s.suspend_reason &&
      Number(s.score) >= Number(s.pass_score ?? 5)
  ).length;
  const avgScore =
    totalTaken > 0
      ? (
          submissions.reduce((sum, item) => sum + Number(item.score), 0) /
          totalTaken
        ).toFixed(2)
      : "0.00";

  return (
    <div className="page-container">
      {error && (
        <div className="alert-box alert-error">
          {error}{" "}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => window.location.reload()}
          >
            Thử lại
          </button>
        </div>
      )}

      <div className="page-header-block">
        <div>
          <span className="section-badge">KẾT QUẢ HỌC TẬP CÁ NHÂN</span>
          <h1>Lịch sử làm bài thi của bạn</h1>
          <p>Theo dõi tiến độ điểm số, thời gian làm bài và xem lại đáp án chi tiết.</p>
        </div>
        <Link to="/" className="btn-primary">
          + Làm bài thi mới
        </Link>
      </div>

      <div className="stats-row">
        <div className="stat-box">
          <div className="stat-icon indigo">📝</div>
          <div>
            <span className="stat-label">Tổng lượt đã thi</span>
            <strong className="stat-value">{totalTaken} bài</strong>
          </div>
        </div>

        <div className="stat-box">
          <div className="stat-icon emerald">🏆</div>
          <div>
            <span className="stat-label">Số bài Đạt chuẩn</span>
            <strong className="stat-value">{passedCount} bài</strong>
          </div>
        </div>

        <div className="stat-box">
          <div className="stat-icon amber">⭐</div>
          <div>
            <span className="stat-label">Điểm trung bình</span>
            <strong className="stat-value">{avgScore} / 10</strong>
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-header">
          <h2>Danh sách các bài thi đã hoàn thành ({filteredSubmissions.length})</h2>
        </div>

        {subjectCategories.length > 0 && (
          <div className="subject-pills-wrap" style={{ marginBottom: "16px" }}>
            <button
              type="button"
              className={`filter-pill ${selectedSubjectCode === "" ? "active" : ""}`}
              onClick={() => setSelectedSubjectCode("")}
            >
              Tất cả ({submissions.length})
            </button>
            {subjectCategories.map((sub) => (
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
          <div className="loading-box">Đang tải lịch sử bài thi...</div>
        ) : error ? null : groupedSubmissions.length === 0 ? (
          <div className="empty-box">
            <div className="empty-emoji">📄</div>
            <h3>Bạn chưa nộp bài thi nào</h3>
            <p>Hãy chọn một đề thi ở Trang chủ để bắt đầu kiểm tra kiến thức nhé!</p>
          </div>
        ) : (
          <div className="subject-groups-stack">
            {groupedSubmissions.map((group) => {
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
                        {group.items.length} lượt thi
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
                            <th>Số câu đúng</th>
                            <th>Thời gian làm bài</th>
                            <th>Thoát tab</th>
                            <th>Điểm số</th>
                            <th>Đánh giá</th>
                            <th style={{ textAlign: "right" }}>Chi tiết</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((item) => {
                            const score = Number(item.score);
                            const isSuspended =
                              Number(item.is_suspended) === 1 ||
                              Boolean(item.suspend_reason);
                            const passed = !isSuspended && score >= Number(item.pass_score ?? 5);
                            const tabCount = Number(item.tab_switch_count) || 0;
                            const tabClass =
                              tabCount === 0
                                ? "safe"
                                : tabCount <= 2
                                ? "warn"
                                : "danger";
                            const { startText, endText, dateText } =
                              resolveTimeRange(item);

                            return (
                              <tr key={item.id}>
                                <td>
                                  <strong>{item.exam_title}</strong>
                                  {isSuspended && (
                                    <div style={{ marginTop: "6px" }}>
                                      <div
                                        className="violation-reason-box"
                                        style={{ padding: "8px 10px", fontSize: "0.8rem" }}
                                      >
                                        <strong>🚫 Bị đình chỉ:</strong>{" "}
                                        {item.suspend_reason || "Vi phạm quy chế phòng thi"}
                                      </div>
                                      <ZaloAppealBox compact />
                                    </div>
                                  )}
                                </td>
                                <td>
                                  <strong>
                                    {item.correct_count} / {item.total_questions}
                                  </strong>{" "}
                                  câu
                                </td>
                                <td>
                                  <div className="time-range-cell">
                                    <span className="time-range-main">
                                      {startText} → {endText}
                                    </span>
                                    <span className="time-range-sub">
                                      {dateText} • {formatDuration(item.time_spent_seconds)}
                                    </span>
                                  </div>
                                </td>
                                <td>
                                  <span className={`tab-switch-badge ${tabClass}`}>
                                    {tabCount} lần
                                  </span>
                                </td>
                                <td>
                                  <span
                                    className={`score-pill ${
                                      score >= 8
                                        ? "high"
                                        : score >= 5
                                        ? "medium"
                                        : "low"
                                    }`}
                                  >
                                    {score.toFixed(2)} đ
                                  </span>
                                </td>
                                <td>
                                  <span
                                    className={`status-tag ${
                                      isSuspended ? "fail" : passed ? "pass" : "fail"
                                    }`}
                                  >
                                    {isSuspended
                                      ? "🚫 BỊ ĐÌNH CHỈ"
                                      : passed
                                      ? "ĐẠT"
                                      : "CHƯA ĐẠT"}
                                  </span>
                                </td>
                                <td style={{ textAlign: "right" }}>
                                    <Link
                                      to={`/results/${item.id}`}
                                      className="btn-table-action"
                                    >
                                      {item.can_view_answers ? "Xem đáp án →" : "Xem kết quả →"}
                                    </Link>
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
      </div>
    </div>
  );
}
