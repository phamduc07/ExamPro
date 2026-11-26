import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axiosClient from "../../api/axiosClient";
import { createRealtimeSocket } from "../../api/socketClient";
import { useDialog } from "../../context/DialogContext";
import { MAJOR_GROUP_LABELS } from "../../utils/ptitHelper";

const STATUS_SORT_ORDER = {
  UNFOCUSED: 0,
  WORKING: 1,
  SUSPENDED: 2,
  SUBMITTED: 3,
};

function sortLiveStudents(list) {
  return [...list].sort((a, b) => {
    const diff =
      (STATUS_SORT_ORDER[a.live_status] ?? 9) -
      (STATUS_SORT_ORDER[b.live_status] ?? 9);
    if (diff !== 0) return diff;
    if ((Number(b.tab_switch_count) || 0) !== (Number(a.tab_switch_count) || 0)) {
      return (Number(b.tab_switch_count) || 0) - (Number(a.tab_switch_count) || 0);
    }
    return String(a.student_code || "").localeCompare(String(b.student_code || ""));
  });
}

function formatClockStamp(raw) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatFocusDuration(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  if (safe < 60) return `${safe}s`;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}p ${s}s`;
}

export default function LiveProctoringSection({
  openExams = [],
  focusedExamId = null,
  onSelectExamId,
  onOpenSuspend,
  onRealtimeChange,
}) {
  const { showToast } = useDialog();
  const [selectedExamId, setSelectedExamId] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [examInfo, setExamInfo] = useState(null);
  const [students, setStudents] = useState([]);
  const [violations, setViolations] = useState([]);
  const [studentStatusFilter, setStudentStatusFilter] = useState("ALL");
  const [violationFilter, setViolationFilter] = useState("ALL");
  const [filterUserId, setFilterUserId] = useState(null);
  const [reviewingId, setReviewingId] = useState(null);
  const [liveExamActivity, setLiveExamActivity] = useState({});

  const socketRef = useRef(null);
  const watchedExamRef = useRef(null);
  const onRealtimeChangeRef = useRef(onRealtimeChange);

  useEffect(() => {
    onRealtimeChangeRef.current = onRealtimeChange;
  }, [onRealtimeChange]);

  useEffect(() => {
    if (focusedExamId && openExams.some((ex) => Number(ex.id) === Number(focusedExamId))) {
      setSelectedExamId(Number(focusedExamId));
      return;
    }
    if (openExams.length === 0) {
      setSelectedExamId(null);
      return;
    }
    setSelectedExamId((prev) => {
      if (prev && openExams.some((ex) => Number(ex.id) === Number(prev))) {
        return prev;
      }
      const withActive = openExams.find((ex) => Number(ex.in_progress_count) > 0);
      return Number((withActive || openExams[0]).id);
    });
  }, [openExams, focusedExamId]);

  const applySnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    setExamInfo(snapshot.exam || null);
    setStudents(sortLiveStudents(snapshot.students || []));
    setViolations(snapshot.violations || []);
  }, []);

  const fetchSnapshotFallback = useCallback(
    async (examId) => {
      if (!examId) return;
      setLoadingSnapshot(true);
      try {
        const res = await axiosClient.get(`/exams/${examId}/live-proctoring`);
        if (res.data?.success && res.data.data) {
          applySnapshot(res.data.data);
        }
      } catch {
        return;
      } finally {
        setLoadingSnapshot(false);
      }
    },
    [applySnapshot]
  );

  useEffect(() => {
    const socket = createRealtimeSocket();
    socketRef.current = socket;

    const handleConnect = () => {
      setSocketConnected(true);
      const currentExamId = watchedExamRef.current;
      if (currentExamId) {
        socket.emit("proctor:watch_exam", { examId: currentExamId }, (ack) => {
          if (ack?.success && ack.data) {
            applySnapshot(ack.data);
          }
        });
      }
    };

    const handleDisconnect = () => {
      setSocketConnected(false);
    };

    const handleStudentUpdate = (payload) => {
      const incomingExamId = Number(payload?.examId);
      const incomingStudent = payload?.student;
      if (!incomingExamId || !incomingStudent) return;

      setLiveExamActivity((prev) => ({
        ...prev,
        [incomingExamId]: Date.now(),
      }));

      if (incomingExamId === Number(watchedExamRef.current)) {
        setStudents((prev) => {
          const exists = prev.some(
            (st) => Number(st.user_id) === Number(incomingStudent.user_id)
          );
          const next = exists
            ? prev.map((st) =>
                Number(st.user_id) === Number(incomingStudent.user_id)
                  ? { ...st, ...incomingStudent }
                  : st
              )
            : [incomingStudent, ...prev];
          return sortLiveStudents(next);
        });
      }

      if (onRealtimeChangeRef.current) {
        onRealtimeChangeRef.current(payload);
      }
    };

    const handleViolationNew = (payload) => {
      const incomingExamId = Number(payload?.examId);
      const vLog = payload?.violation;
      const incomingStudent = payload?.student;
      if (!incomingExamId || !vLog) return;

      if (incomingExamId === Number(watchedExamRef.current)) {
        setViolations((prev) => {
          if (prev.some((v) => Number(v.id) === Number(vLog.id))) return prev;
          return [vLog, ...prev];
        });
        if (incomingStudent) {
          setStudents((prev) => {
            const exists = prev.some(
              (st) => Number(st.user_id) === Number(incomingStudent.user_id)
            );
            const next = exists
              ? prev.map((st) =>
                  Number(st.user_id) === Number(incomingStudent.user_id)
                    ? { ...st, ...incomingStudent }
                    : st
                )
              : [incomingStudent, ...prev];
            return sortLiveStudents(next);
          });
        }
      }

      if (onRealtimeChangeRef.current) {
        onRealtimeChangeRef.current(payload);
      }
    };

    const handleViolationReviewed = (payload) => {
      const incomingExamId = Number(payload?.examId);
      const updatedLog = payload?.violation;
      const incomingStudent = payload?.student;
      if (!incomingExamId || !updatedLog) return;

      if (incomingExamId === Number(watchedExamRef.current)) {
        setViolations((prev) =>
          prev.map((v) =>
            Number(v.id) === Number(updatedLog.id) ? { ...v, ...updatedLog } : v
          )
        );
        if (incomingStudent) {
          setStudents((prev) =>
            sortLiveStudents(
              prev.map((st) =>
                Number(st.user_id) === Number(incomingStudent.user_id)
                  ? { ...st, ...incomingStudent }
                  : st
              )
            )
          );
        }
      }

      if (onRealtimeChangeRef.current) {
        onRealtimeChangeRef.current(payload);
      }
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("proctor:student_update", handleStudentUpdate);
    socket.on("proctor:violation_new", handleViolationNew);
    socket.on("proctor:violation_reviewed", handleViolationReviewed);

    if (socket.connected) {
      setSocketConnected(true);
    }

    return () => {
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [applySnapshot]);

  useEffect(() => {
    const prevWatched = watchedExamRef.current;
    if (prevWatched && prevWatched !== selectedExamId && socketRef.current?.connected) {
      socketRef.current.emit("proctor:unwatch_exam", { examId: prevWatched });
    }
    watchedExamRef.current = selectedExamId;
    setFilterUserId(null);

    if (!selectedExamId) {
      setExamInfo(null);
      setStudents([]);
      setViolations([]);
      return;
    }

    fetchSnapshotFallback(selectedExamId);

    if (socketRef.current?.connected) {
      socketRef.current.emit(
        "proctor:watch_exam",
        { examId: selectedExamId },
        (ack) => {
          if (ack?.success && ack.data) {
            applySnapshot(ack.data);
          }
        }
      );
    }
  }, [selectedExamId, applySnapshot, fetchSnapshotFallback]);

  const handleChooseExam = (examId) => {
    const numId = Number(examId);
    setSelectedExamId(numId);
    if (onSelectExamId) onSelectExamId(numId);
  };

  const handleReviewViolation = async (violation, decision) => {
    if (!selectedExamId || reviewingId) return;
    setReviewingId(violation.id);
    try {
      const res = await axiosClient.patch(
        `/exams/${selectedExamId}/violations/${violation.id}/review`,
        { decision }
      );
      const data = res.data?.data;
      if (data?.violationLog) {
        setViolations((prev) =>
          prev.map((item) =>
            Number(item.id) === Number(data.violationLog.id)
              ? { ...item, ...data.violationLog }
              : item
          )
        );
      }
      if (data?.studentRow) {
        setStudents((prev) =>
          sortLiveStudents(
            prev.map((st) =>
              Number(st.user_id) === Number(data.studentRow.user_id)
                ? { ...st, ...data.studentRow }
                : st
            )
          )
        );
      }
      showToast(
        decision === "DISMISSED"
          ? `✅ Đã bỏ qua lỗi cho SV ${violation.full_name} (Còn ${data?.validViolationCount ?? 0} lỗi hợp lệ).`
          : `⚠️ Đã xác nhận lỗi vi phạm của SV ${violation.full_name} (${data?.validViolationCount ?? 0} lỗi hợp lệ).`,
        decision === "DISMISSED" ? "success" : "warning"
      );
    } catch (err) {
      showToast(
        err.response?.data?.message || "Không thể duyệt log vi phạm.",
        "error"
      );
    } finally {
      setReviewingId(null);
    }
  };

  const counts = useMemo(() => {
    let working = 0;
    let unfocused = 0;
    let submitted = 0;
    let suspended = 0;
    for (const st of students) {
      if (st.live_status === "WORKING") working++;
      else if (st.live_status === "UNFOCUSED") unfocused++;
      else if (st.live_status === "SUBMITTED") submitted++;
      else if (st.live_status === "SUSPENDED") suspended++;
    }
    const pendingViolations = violations.filter((v) => v.status === "PENDING").length;
    return {
      working,
      unfocused,
      submitted,
      suspended,
      pendingViolations,
    };
  }, [students, violations]);

  const filteredStudents = useMemo(() => {
    if (studentStatusFilter === "ALL") return students;
    return students.filter((st) => st.live_status === studentStatusFilter);
  }, [students, studentStatusFilter]);

  const filteredViolations = useMemo(() => {
    return violations.filter((v) => {
      if (filterUserId && Number(v.user_id) !== Number(filterUserId)) {
        return false;
      }
      if (violationFilter !== "ALL" && v.status !== violationFilter) {
        return false;
      }
      return true;
    });
  }, [violations, violationFilter, filterUserId]);

  const filteredStudentObj = useMemo(
    () =>
      filterUserId
        ? students.find((s) => Number(s.user_id) === Number(filterUserId)) || null
        : null,
    [students, filterUserId]
  );

  const maxAllowedTabs =
    examInfo && Boolean(Number(examInfo.anti_cheat))
      ? Number(examInfo.max_tab_switches) >= 1
        ? Number(examInfo.max_tab_switches)
        : 3
      : null;

  return (
    <section className="panel-card live-proctor-panel" style={{ marginBottom: "24px" }}>
      <div className="live-proctor-header">
        <div>
          <div className="live-proctor-title-row">
            <span className="section-badge">REAL-TIME PROCTORING</span>
            <span
              className={`live-socket-pill ${socketConnected ? "online" : "offline"}`}
            >
              <span className="live-socket-dot" />
              {socketConnected
                ? "Socket.IO Trực tuyến"
                : "Đang đồng bộ kết nối..."}
            </span>
          </div>
          <h2 style={{ marginTop: "6px" }}>
            📡 Phòng Giám thị Theo dõi Thời gian thực
          </h2>
          <p className="sub-text" style={{ marginTop: "2px" }}>
            Tự động cập nhật tức thì khi thí sinh vào thi, mất focus, quay lại bài làm, vi phạm Anti-Cheat hoặc nộp bài.
          </p>
        </div>

        {selectedExamId && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => fetchSnapshotFallback(selectedExamId)}
            disabled={loadingSnapshot}
          >
            🔄 Đồng bộ lại
          </button>
        )}
      </div>

      {openExams.length === 0 ? (
        <div className="empty-box" style={{ padding: "28px 16px" }}>
          <div className="empty-emoji">📡</div>
          <h3>Hiện chưa có đề thi nào đang mở</h3>
          <p>Khi có đề thi đang mở trực tuyến, danh sách phòng thi thời gian thực sẽ xuất hiện tại đây.</p>
        </div>
      ) : (
        <>
          <div className="live-exam-selector">
            <span className="anomaly-filter-label">Chọn đề thi đang mở:</span>
            <div className="subject-pills-wrap">
              {openExams.map((ex) => {
                const isSelected = Number(ex.id) === Number(selectedExamId);
                const recentlyActive =
                  liveExamActivity[ex.id] &&
                  Date.now() - liveExamActivity[ex.id] < 8000;
                return (
                  <button
                    key={ex.id}
                    type="button"
                    className={`filter-pill ${isSelected ? "active" : ""} ${
                      recentlyActive ? "live-pulse-border" : ""
                    }`}
                    onClick={() => handleChooseExam(ex.id)}
                  >
                    [{ex.subject_code}] {ex.title}
                    {Number(ex.in_progress_count) > 0 && !isSelected
                      ? ` • ${ex.in_progress_count} đang thi`
                      : ""}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="live-kpi-strip">
            <button
              type="button"
              className={`live-kpi-card ${
                studentStatusFilter === "ALL" ? "selected" : ""
              }`}
              onClick={() => setStudentStatusFilter("ALL")}
            >
              <span className="live-kpi-label">👥 Tổng thí sinh ca này</span>
              <strong className="live-kpi-value">{students.length}</strong>
            </button>
            <button
              type="button"
              className={`live-kpi-card working ${
                studentStatusFilter === "WORKING" ? "selected" : ""
              }`}
              onClick={() => setStudentStatusFilter("WORKING")}
            >
              <span className="live-kpi-label">🟢 Đang làm bài</span>
              <strong className="live-kpi-value">{counts.working}</strong>
            </button>
            <button
              type="button"
              className={`live-kpi-card unfocused ${
                counts.unfocused > 0 ? "alerting" : ""
              } ${studentStatusFilter === "UNFOCUSED" ? "selected" : ""}`}
              onClick={() => setStudentStatusFilter("UNFOCUSED")}
            >
              <span className="live-kpi-label">👀 Đang mất focus</span>
              <strong className="live-kpi-value">{counts.unfocused}</strong>
            </button>
            <button
              type="button"
              className={`live-kpi-card submitted ${
                studentStatusFilter === "SUBMITTED" ? "selected" : ""
              }`}
              onClick={() => setStudentStatusFilter("SUBMITTED")}
            >
              <span className="live-kpi-label">✅ Đã nộp bài</span>
              <strong className="live-kpi-value">{counts.submitted}</strong>
            </button>
            <div
              className={`live-kpi-card violations ${
                counts.pendingViolations > 0 ? "alerting" : ""
              }`}
            >
              <span className="live-kpi-label">🚨 Lỗi chờ Giám thị duyệt</span>
              <strong className="live-kpi-value">{counts.pendingViolations}</strong>
            </div>
          </div>

          <div className="live-proctor-grid">
            <div className="live-proctor-col">
              <div className="live-col-header">
                <h3>
                  👨‍🎓 Thí sinh theo dõi trực tiếp ({filteredStudents.length})
                </h3>
                {studentStatusFilter !== "ALL" && (
                  <button
                    type="button"
                    className="btn-sm picker-bank-btn"
                    onClick={() => setStudentStatusFilter("ALL")}
                  >
                    Hiện tất cả ({students.length})
                  </button>
                )}
              </div>

              {loadingSnapshot && students.length === 0 ? (
                <div className="loading-box">Đang tải trạng thái phòng thi...</div>
              ) : filteredStudents.length === 0 ? (
                <div className="bulk-preview-empty">
                  Chưa có thí sinh nào ở trạng thái này trong đề thi đang chọn.
                </div>
              ) : (
                <div className="table-responsive live-table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Thí sinh</th>
                        <th>Trạng thái hiện tại</th>
                        <th>Số lần vi phạm</th>
                        <th>Tổng TG mất focus</th>
                        <th style={{ textAlign: "right" }}>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStudents.map((st) => {
                        const validCount = Number(st.tab_switch_count) || 0;
                        const pendingCnt = Number(st.pending_violation_count) || 0;
                        const dismissedCnt = Number(st.dismissed_violation_count) || 0;
                        const unfocusedSec = Number(st.unfocused_seconds) || 0;
                        const isFilteredStudent =
                          Number(filterUserId) === Number(st.user_id);

                        return (
                          <tr
                            key={st.user_id}
                            className={
                              st.live_status === "UNFOCUSED"
                                ? "live-row-unfocused"
                                : isFilteredStudent
                                ? "live-row-selected"
                                : ""
                            }
                          >
                            <td>
                              <div>
                                <span className="code-badge">
                                  {st.student_code || `ID#${st.user_id}`}
                                </span>{" "}
                                <strong>{st.full_name}</strong>
                              </div>
                              <div className="sub-text" style={{ marginTop: "3px" }}>
                                {MAJOR_GROUP_LABELS[st.major_group] || "Chưa phân khối"}
                                {st.started_at
                                  ? ` • Vào lúc ${formatClockStamp(st.started_at)}`
                                  : ""}
                              </div>
                            </td>
                            <td>
                              {st.live_status === "WORKING" && (
                                <span className="live-status-badge working">
                                  🟢 Đang làm bài
                                </span>
                              )}
                              {st.live_status === "UNFOCUSED" && (
                                <span className="live-status-badge unfocused">
                                  👀 Đang mất focus
                                </span>
                              )}
                              {st.live_status === "SUBMITTED" && (
                                <div>
                                  <span className="live-status-badge submitted">
                                    ✅ Đã nộp
                                    {st.score !== null && st.score !== undefined
                                      ? ` (${Number(st.score).toFixed(2)}đ)`
                                      : ""}
                                  </span>
                                  {st.submitted_at && (
                                    <div className="sub-text" style={{ marginTop: "2px" }}>
                                      Nộp lúc {formatClockStamp(st.submitted_at)}
                                    </div>
                                  )}
                                </div>
                              )}
                              {st.live_status === "SUSPENDED" && (
                                <span className="live-status-badge suspended">
                                  🛑 Đã đình chỉ (0đ)
                                </span>
                              )}
                            </td>
                            <td>
                              <span
                                className={`tab-switch-badge ${
                                  validCount === 0
                                    ? "safe"
                                    : validCount <= 2
                                    ? "warn"
                                    : "danger"
                                }`}
                              >
                                {validCount}
                                {maxAllowedTabs ? `/${maxAllowedTabs}` : ""} lỗi
                              </span>
                              {(pendingCnt > 0 || dismissedCnt > 0) && (
                                <div className="sub-text" style={{ marginTop: "3px" }}>
                                  {pendingCnt > 0 ? `${pendingCnt} chờ duyệt` : ""}
                                  {pendingCnt > 0 && dismissedCnt > 0 ? " • " : ""}
                                  {dismissedCnt > 0 ? `${dismissedCnt} đã tha` : ""}
                                </div>
                              )}
                            </td>
                            <td>
                              <span
                                className={`tab-switch-badge ${
                                  unfocusedSec === 0
                                    ? "safe"
                                    : unfocusedSec <= 15
                                    ? "warn"
                                    : "danger"
                                }`}
                              >
                                {formatFocusDuration(unfocusedSec)}
                              </span>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <div
                                style={{
                                  display: "inline-flex",
                                  gap: "6px",
                                  flexWrap: "wrap",
                                  justifyContent: "flex-end",
                                }}
                              >
                                <button
                                  type="button"
                                  className="btn-sm picker-bank-btn"
                                  onClick={() =>
                                    setFilterUserId((prev) =>
                                      Number(prev) === Number(st.user_id)
                                        ? null
                                        : st.user_id
                                    )
                                  }
                                >
                                  {isFilteredStudent ? "✓ Đang lọc log" : "📋 Log lỗi"}
                                </button>
                                {st.live_status !== "SUSPENDED" && onOpenSuspend && (
                                  <button
                                    type="button"
                                    className="btn-sm delete"
                                    onClick={() =>
                                      onOpenSuspend(
                                        selectedExamId,
                                        st.user_id,
                                        st.full_name,
                                        st.student_code,
                                        st.submission_id
                                      )
                                    }
                                  >
                                    🛑 Đình chỉ
                                  </button>
                                )}
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

            <div className="live-proctor-col">
              <div className="live-col-header">
                <div>
                  <h3>
                    🚨 Nhật ký Vi phạm & Duyệt lỗi ({filteredViolations.length})
                  </h3>
                  {filteredStudentObj && (
                    <div className="sub-text" style={{ marginTop: "3px" }}>
                      Đang lọc theo SV:{" "}
                      <strong>
                        {filteredStudentObj.full_name} (
                        {filteredStudentObj.student_code || filteredStudentObj.user_id})
                      </strong>{" "}
                      <button
                        type="button"
                        className="link-inline-btn"
                        onClick={() => setFilterUserId(null)}
                      >
                        ✕ Bỏ lọc
                      </button>
                    </div>
                  )}
                </div>

                <div className="subject-pills-wrap">
                  <button
                    type="button"
                    className={`filter-pill ${violationFilter === "ALL" ? "active" : ""}`}
                    onClick={() => setViolationFilter("ALL")}
                  >
                    Tất cả ({violations.length})
                  </button>
                  <button
                    type="button"
                    className={`filter-pill ${
                      violationFilter === "PENDING" ? "active" : ""
                    }`}
                    onClick={() => setViolationFilter("PENDING")}
                  >
                    ⏳ Chờ duyệt ({counts.pendingViolations})
                  </button>
                  <button
                    type="button"
                    className={`filter-pill ${
                      violationFilter === "CONFIRMED" ? "active" : ""
                    }`}
                    onClick={() => setViolationFilter("CONFIRMED")}
                  >
                    ⚠️ Đã xác nhận
                  </button>
                  <button
                    type="button"
                    className={`filter-pill ${
                      violationFilter === "DISMISSED" ? "active" : ""
                    }`}
                    onClick={() => setViolationFilter("DISMISSED")}
                  >
                    ✅ Đã bỏ qua
                  </button>
                </div>
              </div>

              {filteredViolations.length === 0 ? (
                <div className="bulk-preview-empty">
                  Chưa ghi nhận log vi phạm nào khớp bộ lọc hiện tại.
                </div>
              ) : (
                <div className="live-violation-feed">
                  {filteredViolations.map((v) => {
                    const isBusy = reviewingId === v.id;
                    return (
                      <div
                        key={v.id}
                        className={`live-violation-item status-${String(
                          v.status || "PENDING"
                        ).toLowerCase()}`}
                      >
                        <div className="live-violation-top">
                          <div className="live-violation-who">
                            <span className="code-badge">
                              {v.student_code || `SV#${v.user_id}`}
                            </span>
                            <strong>{v.full_name}</strong>
                            <span className="sub-text">
                              • {formatClockStamp(v.created_at)}
                            </span>
                          </div>

                          {v.status === "PENDING" && (
                            <span className="tab-switch-badge warn">
                              ⏳ Chờ duyệt
                            </span>
                          )}
                          {v.status === "CONFIRMED" && (
                            <span className="tab-switch-badge danger">
                              ⚠️ Đã xác nhận vi phạm
                            </span>
                          )}
                          {v.status === "DISMISSED" && (
                            <span className="tab-switch-badge safe">
                              ✅ Đã bỏ qua lỗi (Tha lỗi)
                            </span>
                          )}
                        </div>

                        <div className="live-violation-reason">
                          🚨 {v.reason}
                          {Number(v.unfocused_seconds_snapshot) > 0 && (
                            <span className="sub-text">
                              {" "}
                              (Tổng mất focus lúc ghi nhận:{" "}
                              {formatFocusDuration(v.unfocused_seconds_snapshot)})
                            </span>
                          )}
                        </div>

                        <div className="live-violation-actions">
                          <span className="sub-text">
                            {v.reviewed_at
                              ? `Duyệt bởi ${v.reviewed_by_name || "Giám thị"} lúc ${formatClockStamp(
                                  v.reviewed_at
                                )}`
                              : "Mặc định đang tính 1 lỗi cho đến khi Giám thị bỏ qua"}
                          </span>

                          <div className="live-violation-btns">
                            <button
                              type="button"
                              className="btn-sm picker-bank-btn"
                              disabled={isBusy || v.status === "DISMISSED"}
                              onClick={() => handleReviewViolation(v, "DISMISSED")}
                            >
                              ✅ Bỏ qua lỗi
                            </button>
                            <button
                              type="button"
                              className="btn-sm delete"
                              disabled={isBusy || v.status === "CONFIRMED"}
                              onClick={() => handleReviewViolation(v, "CONFIRMED")}
                            >
                              ⚠️ Xác nhận vi phạm
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
