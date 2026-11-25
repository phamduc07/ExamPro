import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import axiosClient from "../../api/axiosClient";
import { useDialog } from "../../context/DialogContext";
import { MAJOR_GROUP_LABELS } from "../../utils/ptitHelper";
import ExamPreviewModal from "../../components/exam/ExamPreviewModal";

const EXAM_DRAFT_KEY = "ptit_exam_draft";
const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];

function sanitizeIntInput(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits === "") return "";
  return digits.replace(/^0+(?=\d)/, "");
}

function sanitizeDecimalInput(raw) {
  const cleaned = String(raw ?? "").replace(/[^0-9.]/g, "");
  if (cleaned === "") return "";
  const parts = cleaned.split(".");
  const intPart = parts[0].replace(/^0+(?=\d)/, "");
  if (parts.length === 1) return intPart;
  return `${intPart || "0"}.${parts.slice(1).join("")}`;
}

function toDateTimeLocalValue(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function pickPrioritizingUnused(pool, count) {
  if (count <= 0 || pool.length === 0) return [];
  const shuffle = (arr) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const byCount = new Map();
  for (const q of pool) {
    const cnt = Number(q.exam_count) || 0;
    if (!byCount.has(cnt)) byCount.set(cnt, []);
    byCount.get(cnt).push(q);
  }
  const sortedTiers = Array.from(byCount.keys()).sort((a, b) => a - b);
  const ordered = [];
  for (const tier of sortedTiers) {
    ordered.push(...shuffle(byCount.get(tier)));
  }
  return ordered.slice(0, count);
}

const emptyExam = {
  subjectId: "",
  title: "",
  description: "",
  durationMinutes: "25",
  passScore: "5",
  isPublished: 1,
  majorGroup: "ALL",
  examSession: "",
  examShift: "",
  shuffleQuestions: 0,
  shuffleOptions: 0,
  antiCheat: 0,
  maxTabSwitches: null,
  maxAttempts: null,
  openAt: "",
  closeAt: "",
  questionIds: [],
};

export default function ExamManagerPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast, confirmDialog } = useDialog();

  const [activeTab, setActiveTab] = useState("EXAMS");
  const [exams, setExams] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [submissions, setSubmissions] = useState([]);

  const [form, setForm] = useState(() => {
    try {
      const saved = sessionStorage.getItem(EXAM_DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.form) return { ...emptyExam, ...parsed.form };
      }
    } catch {

    }
    return emptyExam;
  });
  const [editingId, setEditingId] = useState(() => {
    try {
      const saved = sessionStorage.getItem(EXAM_DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed?.editingId ?? null;
      }
    } catch {

    }
    return null;
  });
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [collapsedSubjects, setCollapsedSubjects] = useState({});
  const [editingSubmissionCount, setEditingSubmissionCount] = useState(0);

  const [showRandomPicker, setShowRandomPicker] = useState(false);
  const [excludeSameSession, setExcludeSameSession] = useState(true);
  const [sessionMode, setSessionMode] = useState("FREE");
  const [randomConfig, setRandomConfig] = useState({
    total: "5",
    easy: "",
    medium: "",
    hard: "",
  });
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const isLockedQuestions = Boolean(editingId && editingSubmissionCount > 0);

  const subjectSessions = useMemo(() => {
    const set = new Set();
    for (const ex of exams) {
      if (
        Number(ex.subject_id) === Number(form.subjectId) &&
        ex.exam_session &&
        ex.exam_session.trim()
      ) {
        set.add(ex.exam_session.trim());
      }
    }
    return Array.from(set);
  }, [exams, form.subjectId]);

  const sameSessionExams = useMemo(() => {
    const target = (form.examSession || "").trim().toLowerCase();
    if (!target) return [];
    return exams.filter(
      (ex) =>
        Number(ex.subject_id) === Number(form.subjectId) &&
        ex.exam_session &&
        ex.exam_session.trim().toLowerCase() === target &&
        Number(ex.id) !== Number(editingId || 0)
    );
  }, [exams, form.subjectId, form.examSession, editingId]);

  const sessionTemplateExam = useMemo(() => {
    if (sessionMode !== "EXISTING_SESSION" || editingId) return null;
    const sorted = [...sameSessionExams].sort((a, b) => Number(a.id) - Number(b.id));
    return sorted[0] || null;
  }, [sessionMode, sameSessionExams, editingId]);

  const isSessionLocked = Boolean(sessionTemplateExam);

  const isDuplicateSessionName = useMemo(() => {
    if (editingId || sessionMode !== "NEW_SESSION") return false;
    const target = form.examSession.trim().toLowerCase();
    if (!target) return false;
    return subjectSessions.some((s) => s.toLowerCase() === target);
  }, [editingId, sessionMode, form.examSession, subjectSessions]);

  const isDuplicateShiftName = useMemo(() => {
    if (editingId || sessionMode !== "EXISTING_SESSION") return false;
    const targetShift = form.examShift.trim().toLowerCase();
    if (!targetShift) return false;
    return sameSessionExams.some(
      (ex) => (ex.exam_shift || "").trim().toLowerCase() === targetShift
    );
  }, [editingId, sessionMode, form.examShift, sameSessionExams]);

  const suggestNextShiftForSession = (sessionName) => {
    const target = (sessionName || "").trim().toLowerCase();
    const existing = exams.filter(
      (ex) =>
        Number(ex.subject_id) === Number(form.subjectId) &&
        ex.exam_session &&
        ex.exam_session.trim().toLowerCase() === target
    );
    const usedNames = new Set(
      existing.map((ex) => (ex.exam_shift || "").trim().toLowerCase())
    );
    let n = existing.length + 1;
    while (usedNames.has(`ca ${n}`)) n++;
    return `Ca ${n}`;
  };

  const handleSessionModeChange = (mode) => {
    setSessionMode(mode);
    if (mode === "FREE") {
      setForm((p) => ({ ...p, examSession: "", examShift: "" }));
    } else if (mode === "NEW_SESSION") {
      setForm((p) => ({ ...p, examSession: "", examShift: "Ca 1" }));
    } else if (mode === "EXISTING_SESSION") {
      const firstSession = subjectSessions[0] || "";
      setForm((p) => ({
        ...p,
        examSession: firstSession,
        examShift: firstSession ? suggestNextShiftForSession(firstSession) : "",
      }));
    }
  };

  const hasSessionValidationError =
    !editingId &&
    ((sessionMode === "NEW_SESSION" &&
      (!form.examSession.trim() || isDuplicateSessionName)) ||
      (sessionMode === "EXISTING_SESSION" &&
        (!form.examSession.trim() ||
          !form.examShift.trim() ||
          isDuplicateShiftName)));

  useEffect(() => {
    if (!sessionTemplateExam) return;
    setForm((prev) => ({
      ...prev,
      durationMinutes: String(sessionTemplateExam.duration_minutes ?? 25),
      passScore: String(Number(sessionTemplateExam.pass_score ?? 5)),
      majorGroup: sessionTemplateExam.major_group || "ALL",
      shuffleQuestions: sessionTemplateExam.shuffle_questions ? 1 : 0,
      shuffleOptions: sessionTemplateExam.shuffle_options ? 1 : 0,
      antiCheat: sessionTemplateExam.anti_cheat ? 1 : 0,
      maxTabSwitches:
        sessionTemplateExam.max_tab_switches === null ||
        sessionTemplateExam.max_tab_switches === undefined
          ? null
          : String(Number(sessionTemplateExam.max_tab_switches)),
      maxAttempts:
        sessionTemplateExam.max_attempts === null ||
        sessionTemplateExam.max_attempts === undefined
          ? null
          : String(Number(sessionTemplateExam.max_attempts)),
    }));
    if (Number(sessionTemplateExam.question_count) > 0) {
      setRandomConfig((prev) => ({
        ...prev,
        total: String(sessionTemplateExam.question_count),
      }));
    }
  }, [sessionTemplateExam]);

  const excludedSessionQuestionIds = useMemo(() => {
    const set = new Set();
    for (const ex of sameSessionExams) {
      for (const qId of ex.question_ids || []) {
        set.add(Number(qId));
      }
    }
    return set;
  }, [sameSessionExams]);

  useEffect(() => {
    const querySubjectId = searchParams.get("subject_id");
    const editId = searchParams.get("editId");
    const duplicateId = searchParams.get("duplicateId");

    if (querySubjectId && Number(querySubjectId) > 0) {
      setForm((prev) => ({ ...prev, subjectId: Number(querySubjectId) }));
    }
    if (editId && Number(editId) > 0) {
      handleEditExam({ id: Number(editId) });
    } else if (duplicateId && Number(duplicateId) > 0) {
      handleDuplicateExam({ id: Number(duplicateId) });
    }
    try {
      if (sessionStorage.getItem(EXAM_DRAFT_KEY)) {
        sessionStorage.removeItem(EXAM_DRAFT_KEY);
      }
    } catch {

    }
  }, [searchParams]);

  const groupedExams = useMemo(() => {
    const groups = new Map();
    for (const ex of exams) {
      const key = ex.subject_id;
      if (!groups.has(key)) {
        groups.set(key, {
          subjectId: ex.subject_id,
          subjectCode: ex.subject_code,
          subjectName: ex.subject_name,
          items: [],
        });
      }
      groups.get(key).items.push(ex);
    }
    return Array.from(groups.values());
  }, [exams]);

  const toggleSubjectCollapse = (subjectId) => {
    setCollapsedSubjects((prev) => ({
      ...prev,
      [subjectId]: !prev[subjectId],
    }));
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [exRes, subRes, qRes, sumRes] = await Promise.all([
        axiosClient.get("/exams"),
        axiosClient.get("/subjects"),
        axiosClient.get("/questions"),
        axiosClient.get("/submissions"),
      ]);
      const subList = subRes.data.data || [];
      setExams(exRes.data.data || []);
      setSubjects(subList);
      setQuestions(qRes.data.data || []);
      setSubmissions(sumRes.data.data || []);

      if (subList.length > 0 && !form.subjectId) {
        setForm((prev) => ({ ...prev, subjectId: subList[0].id }));
      }
    } catch (err) {
      setNotice({
        type: "error",
        text: err.response?.data?.message || "Lỗi tải dữ liệu quản lý đề thi.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const questionCodeMap = useMemo(() => {
    const bySubject = new Map();
    for (const q of questions) {
      if (!bySubject.has(q.subject_id)) bySubject.set(q.subject_id, []);
      bySubject.get(q.subject_id).push(q);
    }
    const map = {};
    for (const list of bySubject.values()) {
      const sorted = [...list].sort((a, b) => Number(a.id) - Number(b.id));
      sorted.forEach((q, idx) => {
        map[q.id] = `${q.subject_code}-${String(idx + 1).padStart(2, "0")}`;
      });
    }
    return map;
  }, [questions]);

  const availableQuestions = useMemo(
    () =>
      questions
        .filter((q) => Number(q.subject_id) === Number(form.subjectId))
        .sort((a, b) => Number(a.id) - Number(b.id)),
    [questions, form.subjectId]
  );

  const handleGoToQuestionBank = () => {
    try {
      sessionStorage.setItem(
        EXAM_DRAFT_KEY,
        JSON.stringify({ form, editingId })
      );
    } catch {

    }
    const params = new URLSearchParams({ from: "exam-builder" });
    if (form.subjectId) {
      params.set("subject_id", String(form.subjectId));
    }
    navigate(`/teacher/questions?${params.toString()}`);
  };

  const toggleSelectQuestion = (qId) => {
    setForm((prev) => {
      const exists = prev.questionIds.includes(qId);
      return {
        ...prev,
        questionIds: exists
          ? prev.questionIds.filter((id) => id !== qId)
          : [...prev.questionIds, qId],
      };
    });
  };

  const selectAllSubjectQuestions = () => {
    if (isLockedQuestions) return;
    const allIds = availableQuestions.map((q) => q.id);
    setForm((prev) => ({ ...prev, questionIds: allIds }));
  };

  const selectedQuestionObjects = useMemo(() => {
    const byId = new Map(questions.map((q) => [q.id, q]));
    return form.questionIds.map((id) => byId.get(id)).filter(Boolean);
  }, [questions, form.questionIds]);

  const moveSelectedQuestion = (index, direction) => {
    if (isLockedQuestions) return;
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= form.questionIds.length) return;
    setForm((prev) => {
      const next = [...prev.questionIds];
      [next[index], next[targetIdx]] = [next[targetIdx], next[index]];
      return { ...prev, questionIds: next };
    });
  };

  const handleApplyRandomPick = () => {
    if (isLockedQuestions || availableQuestions.length === 0) return;
    const shouldExclude =
      Boolean(form.examSession.trim()) &&
      excludeSameSession &&
      excludedSessionQuestionIds.size > 0;

    const candidatePool = shouldExclude
      ? availableQuestions.filter((q) => !excludedSessionQuestionIds.has(Number(q.id)))
      : availableQuestions;

    if (candidatePool.length === 0) {
      setNotice({
        type: "error",
        text: "⚠️ Không còn câu hỏi nào chưa dùng trong các ca trước của đợt thi này. Hãy tắt tùy chọn loại trừ hoặc bổ sung thêm câu hỏi.",
      });
      return;
    }

    const easyN = Math.max(0, Number(randomConfig.easy) || 0);
    const medN = Math.max(0, Number(randomConfig.medium) || 0);
    const hardN = Math.max(0, Number(randomConfig.hard) || 0);
    const hasMatrix = easyN + medN + hardN > 0;

    let picked = [];
    if (hasMatrix) {
      picked = [
        ...pickPrioritizingUnused(
          candidatePool.filter((q) => q.difficulty === "EASY"),
          easyN
        ),
        ...pickPrioritizingUnused(
          candidatePool.filter((q) => (q.difficulty || "MEDIUM") === "MEDIUM"),
          medN
        ),
        ...pickPrioritizingUnused(
          candidatePool.filter((q) => q.difficulty === "HARD"),
          hardN
        ),
      ];
    } else {
      const totalN = Math.max(1, Number(randomConfig.total) || 1);
      picked = pickPrioritizingUnused(candidatePool, totalN);
    }

    setForm((prev) => ({
      ...prev,
      questionIds: picked.map((q) => q.id),
    }));
    setNotice({
      type: "success",
      text: shouldExclude
        ? `🎲 Đã bốc ngẫu nhiên ${picked.length} câu hỏi (đã loại trừ ${excludedSessionQuestionIds.size} câu thuộc các ca trước trong đợt "${form.examSession.trim()}")!`
        : `🎲 Đã bốc ngẫu nhiên ${picked.length} câu hỏi (ưu tiên câu chưa sử dụng & ít xuất hiện nhất)!`,
    });
    setShowRandomPicker(false);
  };

  const handleDuplicateCurrentToNew = () => {
    setEditingId(null);
    setEditingSubmissionCount(0);
    setForm((prev) => ({
      ...prev,
      title: prev.title.endsWith("(Bản sao)") ? prev.title : `${prev.title} (Bản sao)`,
      isPublished: 0,
    }));
    setNotice({
      type: "success",
      text: "📋 Đã nhân bản thành đề thi mới! Bạn có thể chỉnh sửa câu hỏi và xuất bản.",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDuplicateExam = async (exam) => {
    try {
      const res = await axiosClient.get(`/exams/${exam.id}`);
      const detail = res.data.data;
      setEditingId(null);
      setEditingSubmissionCount(0);
      setForm({
        subjectId: detail.subject_id,
        title: `${detail.title} (Bản sao)`,
        description: detail.description || "",
        durationMinutes: String(detail.duration_minutes ?? 25),
        passScore: String(Number(detail.pass_score ?? 5)),
        isPublished: 0,
        majorGroup: detail.major_group || "ALL",
        examSession: detail.exam_session || "",
        examShift: detail.exam_shift || "",
        shuffleQuestions: detail.shuffle_questions ? 1 : 0,
        shuffleOptions: detail.shuffle_options ? 1 : 0,
        antiCheat: detail.anti_cheat ? 1 : 0,
        maxTabSwitches:
          detail.max_tab_switches === null || detail.max_tab_switches === undefined
            ? null
            : String(Number(detail.max_tab_switches)),
        maxAttempts:
          detail.max_attempts === null || detail.max_attempts === undefined
            ? null
            : String(Number(detail.max_attempts)),
        openAt: toDateTimeLocalValue(detail.open_at),
        closeAt: toDateTimeLocalValue(detail.close_at),
        questionIds: (detail.questions || []).map((q) => q.id),
      });
      setActiveTab("EXAMS");
      setNotice({
        type: "success",
        text: `📋 Đã nhân bản đề "${detail.title}" sang form tạo mới!`,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      showToast(err.response?.data?.message || "Không thể nhân bản đề thi.", "error");
    }
  };

  const handleSaveExam = async (e) => {
    e.preventDefault();
    if (saving) return;
    setNotice({ type: "", text: "" });

    if (!isLockedQuestions && form.questionIds.length === 0) {
      setNotice({
        type: "error",
        text: "⚠️ Vui lòng tích chọn ít nhất 1 câu hỏi cho đề thi!",
      });
      return;
    }

    if (
      isSessionLocked &&
      form.questionIds.length !== Number(sessionTemplateExam.question_count)
    ) {
      setNotice({
        type: "error",
        text: `⚠️ Đợt thi "${form.examSession.trim()}" yêu cầu chọn đúng ${sessionTemplateExam.question_count} câu hỏi để đồng bộ với các ca trước (hiện đang chọn ${form.questionIds.length} câu).`,
      });
      return;
    }

    const payload = {
      ...form,
      sessionMode: editingId ? "FREE" : sessionMode,
      examSession: !editingId && sessionMode === "FREE" ? "" : form.examSession,
      examShift: !editingId && sessionMode === "FREE" ? "" : form.examShift,
      durationMinutes: Number(form.durationMinutes) || 25,
      passScore: form.passScore === "" ? 5 : Number(form.passScore),
      maxTabSwitches:
        form.maxTabSwitches === null || form.maxTabSwitches === ""
          ? null
          : Number(form.maxTabSwitches),
      maxAttempts:
        form.maxAttempts === null || form.maxAttempts === ""
          ? null
          : Number(form.maxAttempts),
      openAt: form.openAt ? new Date(form.openAt).toISOString() : null,
      closeAt: form.closeAt ? new Date(form.closeAt).toISOString() : null,
    };

    setSaving(true);
    try {
      if (editingId) {
        await axiosClient.put(`/exams/${editingId}`, payload);
        setEditingId(null);
        setEditingSubmissionCount(0);
        navigate("/teacher/history");
        return;
      } else {
        await axiosClient.post("/exams", payload);
        setNotice({ type: "success", text: "✅ Tạo đề thi mới thành công!" });
      }
      setEditingId(null);
      setEditingSubmissionCount(0);
      setForm({ ...emptyExam, subjectId: subjects[0]?.id || "" });
      loadData();
    } catch (err) {
      setNotice({
        type: "error",
        text: err.response?.data?.message || "Không thể lưu đề thi.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEditExam = async (exam) => {
    try {
      const res = await axiosClient.get(`/exams/${exam.id}`);
      const detail = res.data.data;
      setEditingId(detail.id);
      setEditingSubmissionCount(
        Number(detail.submission_count ?? exam.submission_count ?? 0)
      );
      setForm({
        subjectId: detail.subject_id,
        title: detail.title,
        description: detail.description || "",
        durationMinutes: String(detail.duration_minutes ?? 25),
        passScore: String(Number(detail.pass_score ?? 5)),
        isPublished: detail.is_published,
        majorGroup: detail.major_group || "ALL",
        examSession: detail.exam_session || "",
        examShift: detail.exam_shift || "",
        shuffleQuestions: detail.shuffle_questions ? 1 : 0,
        shuffleOptions: detail.shuffle_options ? 1 : 0,
        antiCheat: detail.anti_cheat ? 1 : 0,
        maxTabSwitches:
          detail.max_tab_switches === null || detail.max_tab_switches === undefined
            ? null
            : String(Number(detail.max_tab_switches)),
        maxAttempts:
          detail.max_attempts === null || detail.max_attempts === undefined
            ? null
            : String(Number(detail.max_attempts)),
        openAt: toDateTimeLocalValue(detail.open_at),
        closeAt: toDateTimeLocalValue(detail.close_at),
        questionIds: (detail.questions || []).map((q) => q.id),
      });
      setActiveTab("EXAMS");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      showToast(err.response?.data?.message || "Không thể tải chi tiết đề thi để chỉnh sửa.", "error");
    }
  };

  const handleDeleteExam = async (exam) => {
    const ok = await confirmDialog({
      title: "Xóa đề thi",
      message: `Xóa đề thi "${exam.title}"?`,
      confirmText: "Xóa đề thi",
      tone: "danger",
    });
    if (!ok) return;
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

  const handleReopenExam = async (exam) => {
    const ok = await confirmDialog({
      title: "Mở lại đề thi",
      message: `Mở lại đề thi "${exam.title}" để sinh viên có thể tiếp tục làm bài?`,
      confirmText: "Mở lại đề",
    });
    if (!ok) return;
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

  const handleDeleteSubmission = async (id) => {
    const ok = await confirmDialog({
      title: "Xóa kết quả bài thi",
      message: "Bạn muốn xóa kết quả bài thi này?",
      confirmText: "Xóa kết quả",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await axiosClient.delete(`/submissions/${id}`);
      setNotice({ type: "success", text: "🗑️ Đã xóa lượt nộp bài!" });
      loadData();
    } catch (err) {
      setNotice({ type: "error", text: "Không thể xóa kết quả." });
    }
  };

  return (
    <div className="page-container">
      <div className="page-header-block">
        <div>
          <span className="section-badge">QUẢN LÝ ĐỀ THI & THỐNG KÊ ĐIỂM</span>
          <h1>Quản lý Đề thi & Kết quả Sinh viên</h1>
          <p>
            Thiết lập cấu trúc đề thi từ ngân hàng câu hỏi và theo dõi bảng điểm
            của toàn bộ sinh viên.
          </p>
        </div>

        <div className="tab-switcher">
          <button
            type="button"
            className={`tab-btn ${activeTab === "EXAMS" ? "active" : ""}`}
            onClick={() => setActiveTab("EXAMS")}
          >
            ⚙️ Quản lý Đề thi ({exams.length})
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "RESULTS" ? "active" : ""}`}
            onClick={() => setActiveTab("RESULTS")}
          >
            📊 Bảng điểm Sinh viên ({submissions.length})
          </button>
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
        <>

          <section className="panel-card">
            <div className="panel-header">
              <h2>
                {editingId
                  ? `✏️ Chỉnh sửa Đề thi #${editingId}`
                  : "➕ Tạo Đề thi Trắc nghiệm Mới"}
              </h2>
            </div>

            <form onSubmit={handleSaveExam} className="admin-form">
              {isLockedQuestions && (
                <div className="exam-locked-banner" role="status">
                  <div>
                    <strong>
                      🔒 Đề thi này đã có {editingSubmissionCount} lượt sinh viên nộp bài.
                    </strong>{" "}
                    Bạn có thể cập nhật các thông tin quản trị (Tên đề, Mô tả, Trạng thái, Lịch mở/đóng, Giới hạn lượt thi). Danh sách câu hỏi được khóa để bảo toàn lịch sử điểm.
                  </div>
                  <button
                    type="button"
                    className="btn-sm edit"
                    onClick={handleDuplicateCurrentToNew}
                  >
                    📋 Nhân bản thành đề mới
                  </button>
                </div>
              )}

              <div className="form-row-2">
                <div className="form-field">
                  <label>Học phần / Môn học *</label>
                  <select
                    value={form.subjectId}
                    disabled={isLockedQuestions}
                    onChange={(e) => {
                      const nextSubjectId = Number(e.target.value);
                      setForm((p) => ({
                        ...p,
                        subjectId: nextSubjectId,
                        questionIds: [],
                        examSession: "",
                        examShift: "",
                      }));
                      if (sessionMode === "EXISTING_SESSION") {
                        setSessionMode("FREE");
                      }
                    }}
                    required
                  >
                    <option value="">-- Chọn môn học --</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} - {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label>Tiêu đề đề thi *</label>
                  <input
                    type="text"
                    placeholder="VD: Đề thi Giữa kỳ Lập trình Web - Ca 1"
                    value={form.title}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, title: e.target.value }))
                    }
                    required
                  />
                </div>
              </div>

              <div className="form-row-3">
                <div className="form-field">
                  <label>Thời gian làm bài (Phút) *</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="VD: 30"
                    disabled={isLockedQuestions || isSessionLocked}
                    value={form.durationMinutes}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        durationMinutes: sanitizeIntInput(e.target.value),
                      }))
                    }
                    required
                  />
                  {!isLockedQuestions && !isSessionLocked && (
                    <div className="duration-pills-row">
                      {DURATION_PRESETS.map((mins) => (
                        <button
                          key={mins}
                          type="button"
                          className={`duration-pill-btn ${
                            String(form.durationMinutes) === String(mins) ? "active" : ""
                          }`}
                          onClick={() =>
                            setForm((p) => ({ ...p, durationMinutes: String(mins) }))
                          }
                        >
                          {mins}p
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="form-field">
                  <label>Điểm chuẩn Đạt (Thang 10)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="VD: 5"
                    disabled={isLockedQuestions || isSessionLocked}
                    value={form.passScore}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        passScore: sanitizeDecimalInput(e.target.value),
                      }))
                    }
                  />
                </div>

                <div className="form-field">
                  <label>Trạng thái xuất bản</label>
                  <select
                    value={form.isPublished}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        isPublished: Number(e.target.value),
                      }))
                    }
                  >
                    <option value={1}>🟢 Mở thi công khai (Published)</option>
                    <option value={0}>🔒 Bản nháp tạm khóa (Draft)</option>
                  </select>
                </div>
              </div>

              <div className="form-row-2">
                <div className="form-field">
                  <label>Khối ngành áp dụng *</label>
                  <select
                    value={form.majorGroup}
                    disabled={isLockedQuestions || isSessionLocked}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        majorGroup: e.target.value,
                      }))
                    }
                  >
                    <option value="ALL">🌐 Tất cả khối ngành (Đề chung)</option>
                    <option value="KY_THUAT">⚙️ Khối Kỹ thuật (CN, VT, CC, AT, KH...)</option>
                    <option value="KINH_TE">📈 Khối Kinh tế (PT, MR, QT, KT, TM...)</option>
                  </select>
                </div>

                <div className="form-field">
                  <label>Mô tả / Ghi chú quy chế đề thi</label>
                  <input
                    type="text"
                    placeholder="Nhập mô tả ngắn gọn cho đề thi..."
                    value={form.description}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, description: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="exam-config-box">
                <span className="exam-config-title">📅 Chế độ Kỳ thi / Đợt thi</span>
                {!editingId && (
                  <div className="tab-switcher" style={{ alignSelf: "flex-start" }}>
                    <button
                      type="button"
                      className={`tab-btn ${sessionMode === "FREE" ? "active" : ""}`}
                      onClick={() => handleSessionModeChange("FREE")}
                    >
                      🌐 Thi tự do
                    </button>
                    <button
                      type="button"
                      className={`tab-btn ${sessionMode === "NEW_SESSION" ? "active" : ""}`}
                      onClick={() => handleSessionModeChange("NEW_SESSION")}
                    >
                      ➕ Tạo Đợt thi mới
                    </button>
                    <button
                      type="button"
                      className={`tab-btn ${sessionMode === "EXISTING_SESSION" ? "active" : ""}`}
                      onClick={() => handleSessionModeChange("EXISTING_SESSION")}
                    >
                      📋 Thêm ca vào Đợt có sẵn ({subjectSessions.length})
                    </button>
                  </div>
                )}

                {(!editingId && sessionMode === "NEW_SESSION") && (
                  <div className="form-row-2">
                    <div className="form-field">
                      <label>Tên Đợt thi mới *</label>
                      <input
                        type="text"
                        placeholder="VD: Giữa kỳ HK1 2026-2027"
                        value={form.examSession}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, examSession: e.target.value }))
                        }
                        required
                      />
                      {isDuplicateSessionName && (
                        <span className="field-hint-error">
                          ⚠️ Đợt thi này đã tồn tại! Không thể tạo trùng tên đợt thi (hãy chuyển sang chế độ 'Thêm ca vào Đợt có sẵn' nếu muốn tạo Ca 2).
                        </span>
                      )}
                    </div>

                    <div className="form-field">
                      <label>Tên Ca đầu tiên</label>
                      <input
                        type="text"
                        placeholder="VD: Ca 1"
                        value={form.examShift}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, examShift: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                )}

                {(!editingId && sessionMode === "EXISTING_SESSION") && (
                  subjectSessions.length === 0 ? (
                    <p className="sub-text">
                      Môn học này chưa có đợt thi nào. Hãy chọn <strong>"➕ Tạo Đợt thi mới"</strong> trước.
                    </p>
                  ) : (
                    <div className="form-row-2">
                      <div className="form-field">
                        <label>Chọn Đợt thi có sẵn *</label>
                        <select
                          value={form.examSession}
                          onChange={(e) => {
                            const nextSession = e.target.value;
                            setForm((p) => ({
                              ...p,
                              examSession: nextSession,
                              examShift: nextSession
                                ? suggestNextShiftForSession(nextSession)
                                : "",
                            }));
                          }}
                          required
                        >
                          <option value="">-- Chọn đợt thi --</option>
                          {subjectSessions.map((sessionName) => (
                            <option key={sessionName} value={sessionName}>
                              {sessionName}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="form-field">
                        <label>Tên Ca thi mới *</label>
                        <input
                          type="text"
                          placeholder="VD: Ca 2, Ca 3..."
                          value={form.examShift}
                          onChange={(e) =>
                            setForm((p) => ({ ...p, examShift: e.target.value }))
                          }
                          required
                        />
                        {isDuplicateShiftName && (
                          <span className="field-hint-error">
                            ⚠️ Ca thi này đã tồn tại trong đợt "{form.examSession.trim()}"!
                          </span>
                        )}
                      </div>
                    </div>
                  )
                )}

                {editingId && form.examSession && (
                  <div className="sub-text">
                    Đợt thi hiện tại: <strong>{form.examSession}</strong>
                    {form.examShift ? ` — ${form.examShift}` : ""}
                  </div>
                )}
              </div>

              {isSessionLocked && (
                <div className="exam-locked-banner" role="status" style={{ marginBottom: "0" }}>
                  <span>
                    🔒 Đợt thi <strong>"{form.examSession.trim()}"</strong> đã có đề chuẩn (
                    <strong>{sessionTemplateExam.duration_minutes} phút</strong>,{" "}
                    <strong>{sessionTemplateExam.question_count} câu</strong>, Điểm đạt{" "}
                    <strong>{sessionTemplateExam.pass_score}</strong>). Các thông số quy chế chung đã được đồng bộ cố định để đảm bảo công bằng giữa các ca thi.
                  </span>
                </div>
              )}

              <div className="exam-config-box">
                <span className="exam-config-title">
                  🛡️ Cấu hình phòng thi, Chống gian lận & Lịch mở/đóng đề
                </span>

                <div className="exam-checkbox-row">
                  <label className="exam-checkbox-item">
                    <input
                      type="checkbox"
                      disabled={isSessionLocked}
                      checked={Boolean(form.shuffleQuestions)}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          shuffleQuestions: e.target.checked ? 1 : 0,
                        }))
                      }
                    />
                    <span>🔀 Trộn ngẫu nhiên thứ tự câu hỏi</span>
                  </label>

                  <label className="exam-checkbox-item">
                    <input
                      type="checkbox"
                      disabled={isSessionLocked}
                      checked={Boolean(form.shuffleOptions)}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          shuffleOptions: e.target.checked ? 1 : 0,
                        }))
                      }
                    />
                    <span>🔀 Trộn ngẫu nhiên 4 đáp án A/B/C/D</span>
                  </label>
                </div>

                <label
                  className="exam-checkbox-item"
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: form.antiCheat
                      ? "1px solid var(--rose)"
                      : "1px solid var(--border-color)",
                    background: form.antiCheat
                      ? "var(--rose-light)"
                      : "rgba(15, 23, 42, 0.45)",
                  }}
                >
                  <input
                    type="checkbox"
                    disabled={isSessionLocked}
                    checked={Boolean(form.antiCheat)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setForm((p) => ({
                        ...p,
                        antiCheat: checked ? 1 : 0,
                        maxTabSwitches: checked ? "1" : null,
                        maxAttempts: checked ? "1" : null,
                      }));
                    }}
                  />
                  <div>
                    <strong style={{ color: form.antiCheat ? "#fecdd3" : "var(--text-main)" }}>
                      🛡️ Bật chế độ Chống gian lận nghiêm ngặt (Anti-Cheat)
                    </strong>
                    <div className="sub-text">
                      Chỉ áp dụng khóa DevTools, chống copy, toàn màn hình và giám sát chặt cho đề này.
                    </div>
                  </div>
                </label>

                <div className="form-row-2">
                  <div className="form-field">
                    <label>Giới hạn rời tab tối đa</label>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="Không giới hạn"
                        disabled={isSessionLocked || form.maxTabSwitches === null}
                        value={form.maxTabSwitches === null ? "" : form.maxTabSwitches}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            maxTabSwitches: sanitizeIntInput(e.target.value),
                          }))
                        }
                        style={{ flex: 1 }}
                      />
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          whiteSpace: "nowrap",
                          cursor: isSessionLocked ? "not-allowed" : "pointer",
                          fontSize: "0.84rem",
                          color: "var(--text-secondary)",
                          margin: 0,
                        }}
                      >
                        <input
                          type="checkbox"
                          disabled={isSessionLocked}
                          checked={form.maxTabSwitches === null}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              maxTabSwitches: e.target.checked ? null : "0",
                            }))
                          }
                          style={{ width: "auto" }}
                        />
                        Không giới hạn
                      </label>
                    </div>
                    <div className="sub-text">
                      Gợi ý: 1 lần cảnh báo trước khi khóa bài; đặt 0 nếu muốn khóa ngay lập tức
                    </div>
                  </div>

                  <div className="form-field">
                    <label>Giới hạn số lượt thi / SV</label>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="Không giới hạn"
                        disabled={isSessionLocked || form.maxAttempts === null}
                        value={form.maxAttempts === null ? "" : form.maxAttempts}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            maxAttempts: sanitizeIntInput(e.target.value),
                          }))
                        }
                        style={{ flex: 1 }}
                      />
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          whiteSpace: "nowrap",
                          cursor: isSessionLocked ? "not-allowed" : "pointer",
                          fontSize: "0.84rem",
                          color: "var(--text-secondary)",
                          margin: 0,
                        }}
                      >
                        <input
                          type="checkbox"
                          disabled={isSessionLocked}
                          checked={form.maxAttempts === null}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              maxAttempts: e.target.checked ? null : "0",
                            }))
                          }
                          style={{ width: "auto" }}
                        />
                        Không giới hạn
                      </label>
                    </div>
                  </div>
                </div>

                <div className="form-row-2">
                  <div className="form-field">
                    <label>Thời gian mở đề tự động (tùy chọn)</label>
                    <input
                      type="datetime-local"
                      value={form.openAt}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, openAt: e.target.value }))
                      }
                    />
                  </div>

                  <div className="form-field">
                    <label>Thời gian đóng đề tự động (tùy chọn)</label>
                    <input
                      type="datetime-local"
                      value={form.closeAt}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, closeAt: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="question-picker-box">
                <div className="picker-header">
                  <div>
                    <strong>
                      📋 Chọn câu hỏi đưa vào đề ({form.questionIds.length} /{" "}
                      {availableQuestions.length} câu đã chọn)
                    </strong>
                    {isSessionLocked && (
                      <div
                        className="sub-text"
                        style={{ color: "var(--amber-bright)", fontWeight: 600 }}
                      >
                        ⚠️ Bắt buộc chọn đúng {sessionTemplateExam.question_count} câu như đề chuẩn trong đợt "{form.examSession.trim()}"
                      </div>
                    )}
                    <div className="q-usage-legend">
                      <span>
                        <i className="q-usage-dot used" /> Đã có trong đề thi
                      </span>
                      <span>
                        <i className="q-usage-dot unused" /> Chưa sử dụng
                      </span>
                    </div>
                  </div>
                  <div className="picker-header-actions">
                    {!isLockedQuestions && (
                      <>
                        {!isSessionLocked && (
                          <button
                            type="button"
                            className="btn-sm edit"
                            onClick={selectAllSubjectQuestions}
                          >
                            ✓ Chọn tất cả câu hỏi môn này
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-sm edit"
                          onClick={() => setShowRandomPicker((prev) => !prev)}
                        >
                          🎲 Bốc ngẫu nhiên
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="btn-sm picker-bank-btn"
                      onClick={handleGoToQuestionBank}
                    >
                      ➕ Thêm câu hỏi / Nhập nhanh
                    </button>
                  </div>
                </div>

                {showRandomPicker && !isLockedQuestions && (
                  <div className="random-pick-panel">
                    {form.examSession.trim() && (
                      <div
                        style={{
                          padding: "10px 12px",
                          borderRadius: "10px",
                          background: "rgba(15, 23, 42, 0.55)",
                          border: "1px solid var(--primary-border)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                        }}
                      >
                        <label className="exam-checkbox-item">
                          <input
                            type="checkbox"
                            checked={excludeSameSession}
                            onChange={(e) => setExcludeSameSession(e.target.checked)}
                          />
                          <strong>
                            🚫 Loại trừ câu hỏi các ca trước trong đợt "{form.examSession.trim()}"
                          </strong>
                        </label>
                        {sameSessionExams.length > 0 ? (
                          <div className="sub-text">
                            Các ca/đề cùng đợt ({sameSessionExams.length}):{" "}
                            {sameSessionExams
                              .map((ex) => ex.exam_shift || ex.title)
                              .join(", ")}{" "}
                            — sẽ loại trừ <strong>{excludedSessionQuestionIds.size}</strong> câu hỏi.
                          </div>
                        ) : (
                          <div className="sub-text">
                            Chưa có ca thi nào khác trong đợt "{form.examSession.trim()}".
                          </div>
                        )}
                      </div>
                    )}

                    <div className="random-pick-grid">
                      <div className="form-field">
                        <label>Tổng số câu</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="5"
                          value={randomConfig.total}
                          onChange={(e) =>
                            setRandomConfig((p) => ({
                              ...p,
                              total: sanitizeIntInput(e.target.value),
                            }))
                          }
                        />
                      </div>
                      <div className="form-field">
                        <label>Số câu Dễ</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          value={randomConfig.easy}
                          onChange={(e) =>
                            setRandomConfig((p) => ({
                              ...p,
                              easy: sanitizeIntInput(e.target.value),
                            }))
                          }
                        />
                      </div>
                      <div className="form-field">
                        <label>Số câu Trung bình</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          value={randomConfig.medium}
                          onChange={(e) =>
                            setRandomConfig((p) => ({
                              ...p,
                              medium: sanitizeIntInput(e.target.value),
                            }))
                          }
                        />
                      </div>
                      <div className="form-field">
                        <label>Số câu Khó</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          value={randomConfig.hard}
                          onChange={(e) =>
                            setRandomConfig((p) => ({
                              ...p,
                              hard: sanitizeIntInput(e.target.value),
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div className="random-pick-actions">
                      <span className="sub-text">
                        Ưu tiên bốc câu chưa sử dụng (chấm xanh). Nếu nhập Dễ/TB/Khó &gt; 0 sẽ bốc theo ma trận độ khó.
                      </span>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleApplyRandomPick}
                      >
                        🎲 Áp dụng bốc ngẫu nhiên
                      </button>
                    </div>
                  </div>
                )}

                {subjects.length > 0 && (
                  <div className="subject-pills-wrap" style={{ marginBottom: "12px" }}>
                    {subjects.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        disabled={isLockedQuestions}
                        className={`filter-pill ${
                          Number(form.subjectId) === Number(s.id) ? "active" : ""
                        }`}
                        onClick={() => {
                          if (isLockedQuestions) return;
                          const isSame = Number(form.subjectId) === Number(s.id);
                          if (isSame) return;
                          setForm((prev) => ({
                            ...prev,
                            subjectId: Number(s.id),
                            questionIds: [],
                            examSession: "",
                            examShift: "",
                          }));
                          if (sessionMode === "EXISTING_SESSION") {
                            setSessionMode("FREE");
                          }
                        }}
                      >
                        {s.code} - {s.name}
                      </button>
                    ))}
                  </div>
                )}

                {availableQuestions.length === 0 ? (
                  <p className="sub-text">
                    Môn học này chưa có câu hỏi nào. Hãy bấm{" "}
                    <strong>"Thêm câu hỏi / Nhập nhanh"</strong> để bổ sung.
                  </p>
                ) : (
                  <div className="picker-list">
                    {availableQuestions.map((q) => {
                      const checked = form.questionIds.includes(q.id);
                      const isUsed = Number(q.exam_count) > 0 || checked;
                      return (
                        <label
                          key={q.id}
                          className={`picker-item ${checked ? "checked" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isLockedQuestions}
                            onChange={() => toggleSelectQuestion(q.id)}
                          />
                          <span className="picker-q-text">
                            <span className="q-code-with-dot" style={{ marginRight: "8px" }}>
                              <span className="code-badge">{questionCodeMap[q.id]}</span>
                              <span
                                className={`q-usage-dot ${isUsed ? "used" : "unused"}`}
                                title={
                                  isUsed
                                    ? "Đã được chọn vào đề thi"
                                    : "Chưa được chọn vào đề nào"
                                }
                              />
                            </span>
                            {q.content}
                          </span>
                          <span className="picker-q-ans">
                            Đáp án: {q.correct_answer}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {selectedQuestionObjects.length > 0 && !isLockedQuestions && (
                  <div className="selected-order-box">
                    <strong style={{ fontSize: "0.86rem" }}>
                      ↕️ Thứ tự câu hỏi trong đề ({selectedQuestionObjects.length} câu):
                    </strong>
                    {selectedQuestionObjects.map((q, idx) => (
                      <div key={q.id} className="selected-order-item">
                        <span>
                          <strong>Câu {idx + 1}.</strong>{" "}
                          <span className="code-badge">{questionCodeMap[q.id]}</span>{" "}
                          {q.content}
                        </span>
                        <div className="selected-order-controls">
                          <button
                            type="button"
                            className="btn-order-step"
                            disabled={idx === 0}
                            title="Di chuyển lên"
                            onClick={() => moveSelectedQuestion(idx, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn-order-step"
                            disabled={idx === selectedQuestionObjects.length - 1}
                            title="Di chuyển xuống"
                            onClick={() => moveSelectedQuestion(idx, 1)}
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-actions-right">
                {editingId && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setEditingId(null);
                      setEditingSubmissionCount(0);
                      setForm({
                        ...emptyExam,
                        subjectId: subjects[0]?.id || "",
                      });
                    }}
                  >
                    Hủy chỉnh sửa
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={selectedQuestionObjects.length === 0}
                  onClick={() => setShowPreviewModal(true)}
                >
                  👁️ Xem trước đề thi ({selectedQuestionObjects.length})
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={saving || hasSessionValidationError}
                >
                  {editingId ? "💾 Lưu cập nhật Đề thi" : "➕ Xuất bản Đề thi mới"}
                </button>
              </div>
            </form>
          </section>
        </>
      ) : (

        <section className="panel-card">
          <div className="panel-header">
            <h2>Bảng điểm toàn bộ lượt thi của Sinh viên ({submissions.length})</h2>
          </div>

          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã SV</th>
                  <th>Họ tên Sinh viên</th>
                  <th>Đề thi & Môn học</th>
                  <th>Số câu đúng</th>
                  <th>Điểm số</th>
                  <th>Thời gian nộp</th>
                  <th style={{ textAlign: "right" }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub) => {
                  const score = Number(sub.score);
                  return (
                    <tr key={sub.id}>
                      <td>
                        <span className="code-badge">
                          {sub.student_code || "SV"}
                        </span>
                      </td>
                      <td>
                        <strong>{sub.student_name}</strong>
                        <div className="sub-text">{sub.student_email}</div>
                      </td>
                      <td>
                        <strong>{sub.exam_title}</strong>
                        <div className="sub-text">
                          {sub.subject_code} • {sub.subject_name}
                        </div>
                      </td>
                      <td>
                        {sub.correct_count} / {sub.total_questions} câu
                      </td>
                      <td>
                        <span
                          className={`score-pill ${
                            score >= 8 ? "high" : score >= 5 ? "medium" : "low"
                          }`}
                        >
                          {score.toFixed(2)} / 10
                        </span>
                      </td>
                      <td>
                        {new Date(sub.submitted_at).toLocaleString("vi-VN")}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div className="action-btn-group">
                          <Link
                            to={`/results/${sub.id}`}
                            className="btn-sm edit"
                          >
                            Xem bài
                          </Link>
                          <button
                            type="button"
                            className="btn-sm delete"
                            onClick={() => handleDeleteSubmission(sub.id)}
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <ExamPreviewModal
        open={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        form={form}
        selectedQuestionObjects={selectedQuestionObjects}
        questionCodeMap={questionCodeMap}
      />
    </div>
  );
}
