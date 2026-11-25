import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import axiosClient from "../../api/axiosClient";
import { useDialog } from "../../context/DialogContext";
import QuickSubjectModal from "../../components/questions/QuickSubjectModal";
import {
  parseBulkQuestions,
  SAMPLE_BULK_QUESTIONS,
  validateParsedQuestion,
} from "../../utils/questionParser";

const emptyQuestion = {
  subjectId: "",
  content: "",
  optionA: "",
  optionB: "",
  optionC: "",
  optionD: "",
  correctAnswer: "A",
  difficulty: "MEDIUM",
  explanation: "",
};

const emptySubject = {
  code: "",
  name: "",
  description: "",
};

function computeTextSimilarity(a, b) {
  const norm = (str) =>
    String(str || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const s1 = norm(a);
  const s2 = norm(b);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  const t1 = new Set(s1.split(" "));
  const t2 = new Set(s2.split(" "));
  let intersection = 0;
  for (const w of t1) {
    if (t2.has(w)) intersection++;
  }
  return (2 * intersection) / (t1.size + t2.size);
}

export default function QuestionBankPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { confirmDialog } = useDialog();
  const initialSubjectId = searchParams.get("subject_id") || "";
  const isFromExamBuilder = searchParams.get("from") === "exam-builder";

  const [activeTab, setActiveTab] = useState("QUESTIONS");
  const [subjects, setSubjects] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [filterSubject, setFilterSubject] = useState(initialSubjectId);
  const [filterSearch, setFilterSearch] = useState("");

  const [qForm, setQForm] = useState({
    ...emptyQuestion,
    subjectId: initialSubjectId,
  });
  const [editingQId, setEditingQId] = useState(null);
  const [editingQuestionMeta, setEditingQuestionMeta] = useState({
    examCount: 0,
    submissionCount: 0,
  });

  const [sForm, setSForm] = useState(emptySubject);
  const [editingSId, setEditingSId] = useState(null);

  const [notice, setNotice] = useState({ type: "", text: "", subjectId: "" });

  const [bulkSectionOpen, setBulkSectionOpen] = useState(true);
  const [bulkSubjectId, setBulkSubjectId] = useState(initialSubjectId);
  const [bulkDifficulty, setBulkDifficulty] = useState("MEDIUM");
  const [bulkText, setBulkText] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [previewQuestions, setPreviewQuestions] = useState([]);
  const [collapsedSubjects, setCollapsedSubjects] = useState({});

  const [showQuickSubjectModal, setShowQuickSubjectModal] = useState(false);
  const [quickSubjectForm, setQuickSubjectForm] = useState(emptySubject);
  const [quickSubjectSaving, setQuickSubjectSaving] = useState(false);
  const [quickSubjectError, setQuickSubjectError] = useState("");

  const openQuickSubjectModal = () => {
    setQuickSubjectError("");
    setQuickSubjectForm(emptySubject);
    setShowQuickSubjectModal(true);
  };

  const closeQuickSubjectModal = () => {
    if (quickSubjectSaving) return;
    setShowQuickSubjectModal(false);
    setQuickSubjectError("");
  };

  const handleQuickCreateSubject = async (e) => {
    e.preventDefault();
    if (quickSubjectSaving) return;
    setQuickSubjectError("");

    const cleanCode = quickSubjectForm.code.trim().toUpperCase();
    const cleanName = quickSubjectForm.name.trim();
    const cleanDesc = quickSubjectForm.description.trim();

    if (!cleanCode || !cleanName) {
      setQuickSubjectError("Vui lòng nhập đầy đủ Mã môn học và Tên môn học.");
      return;
    }

    const isDup = subjects.some(
      (s) => String(s.code || "").trim().toUpperCase() === cleanCode
    );
    if (isDup) {
      setQuickSubjectError(`Mã môn học "${cleanCode}" đã tồn tại.`);
      return;
    }

    setQuickSubjectSaving(true);
    try {
      const res = await axiosClient.post("/subjects", {
        code: cleanCode,
        name: cleanName,
        description: cleanDesc,
      });
      const created = res.data?.data;
      if (created?.id) {
        const newSubjectItem = {
          ...created,
          question_count: 0,
          exam_count: 0,
        };
        setSubjects((prev) => [...prev, newSubjectItem]);
        setQForm((prev) => ({ ...prev, subjectId: String(created.id) }));
        setBulkSubjectId(String(created.id));
        setFilterSubject(String(created.id));
        setNotice({
          type: "success",
          text: `✅ Đã tạo môn học mới "${created.code} - ${created.name}" và tự động chọn sẵn!`,
          subjectId: String(created.id),
        });
      }
      setShowQuickSubjectModal(false);
      setQuickSubjectForm(emptySubject);
    } catch (err) {
      setQuickSubjectError(
        err.response?.data?.message || "Không thể tạo môn học mới."
      );
    } finally {
      setQuickSubjectSaving(false);
    }
  };

  useEffect(() => {
    setPreviewQuestions(parseBulkQuestions(bulkText, bulkDifficulty));
  }, [bulkText, bulkDifficulty]);

  const validBulkQuestions = useMemo(
    () => previewQuestions.filter((q) => q.isValid),
    [previewQuestions]
  );
  const invalidBulkQuestions = useMemo(
    () => previewQuestions.filter((q) => !q.isValid),
    [previewQuestions]
  );
  const invalidBulkCount = invalidBulkQuestions.length;

  const handleSelectPreviewAnswer = (targetIndex, optionKey) => {
    setPreviewQuestions((prev) =>
      prev.map((q) =>
        q.index === targetIndex
          ? validateParsedQuestion({ ...q, correctAnswer: optionKey })
          : q
      )
    );
  };

  const handleRemovePreviewQuestion = (targetIndex) => {
    setPreviewQuestions((prev) => prev.filter((q) => q.index !== targetIndex));
  };

  const toggleSubjectCollapse = (subjectId) => {
    setCollapsedSubjects((prev) => ({
      ...prev,
      [subjectId]: !prev[subjectId],
    }));
  };

  const handleBulkSave = async () => {
    if (bulkSaving) return;
    setBulkError("");

    if (!bulkSubjectId) {
      setBulkError("Vui lòng chọn môn học trước khi lưu.");
      return;
    }
    if (validBulkQuestions.length === 0) {
      setBulkError("Chưa có câu hỏi hợp lệ nào để lưu.");
      return;
    }

    setBulkSaving(true);
    try {
      const payload = {
        subject_id: Number(bulkSubjectId),
        questions: validBulkQuestions.map((q) => ({
          content: q.content,
          optionA: q.optionA,
          optionB: q.optionB,
          optionC: q.optionC,
          optionD: q.optionD,
          correctAnswer: q.correctAnswer,
          difficulty: q.difficulty,
          explanation: q.explanation,
        })),
      };
      const res = await axiosClient.post("/questions/bulk", payload);
      const count = res.data?.data?.insertedCount ?? validBulkQuestions.length;
      setBulkText("");
      setNotice({
        type: "success",
        text: `✅ Đã nhập nhanh thành công ${count} câu hỏi vào ngân hàng!`,
        subjectId: String(bulkSubjectId),
      });
      loadAll();
    } catch (err) {
      setBulkError(
        err.response?.data?.message || "Không thể lưu danh sách câu hỏi."
      );
    } finally {
      setBulkSaving(false);
    }
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [subRes, qRes] = await Promise.all([
        axiosClient.get("/subjects"),
        axiosClient.get("/questions"),
      ]);
      const subList = subRes.data.data || [];
      setSubjects(subList);
      setQuestions(qRes.data.data || []);
      if (subList.length > 0 && !qForm.subjectId) {
        setQForm((prev) => ({ ...prev, subjectId: subList[0].id }));
      }
      if (subList.length > 0 && !bulkSubjectId) {
        setBulkSubjectId(String(subList[0].id));
      }
    } catch (err) {
      setNotice({
        type: "error",
        text: err.response?.data?.message || "Lỗi tải ngân hàng câu hỏi.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleSaveQuestion = async (e) => {
    e.preventDefault();
    if (saving) return;

    if (editingQId && editingQuestionMeta.submissionCount > 0) {
      const confirmed = await confirmDialog({
        title: "Cập nhật câu hỏi & Chấm lại điểm",
        message: `Câu hỏi này đang nằm trong ${editingQuestionMeta.examCount} đề thi và liên quan tới ${editingQuestionMeta.submissionCount} bài đã nộp.\n\nBạn có chắc chắn muốn lưu cập nhật và tự động chấm lại điểm cho toàn bộ ${editingQuestionMeta.submissionCount} bài nộp này không?`,
        confirmText: "Lưu & Chấm lại",
      });
      if (!confirmed) return;
    }

    setNotice({ type: "", text: "", subjectId: "" });
    setSaving(true);
    try {
      if (editingQId) {
        const res = await axiosClient.put(`/questions/${editingQId}`, qForm);
        setNotice({
          type: "success",
          text: `✅ ${res.data?.message || "Cập nhật câu hỏi thành công!"}`,
          subjectId: "",
        });
      } else {
        await axiosClient.post("/questions", qForm);
        setNotice({
          type: "success",
          text: "✅ Đã thêm câu hỏi mới vào ngân hàng!",
          subjectId: String(qForm.subjectId),
        });
      }
      setEditingQId(null);
      setEditingQuestionMeta({ examCount: 0, submissionCount: 0 });
      setQForm({ ...emptyQuestion, subjectId: subjects[0]?.id || "" });
      loadAll();
    } catch (err) {
      setNotice({
        type: "error",
        text: err.response?.data?.message || "Không thể lưu câu hỏi.",
        subjectId: "",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEditQuestion = (q) => {
    setEditingQId(q.id);
    setEditingQuestionMeta({
      examCount: Number(q.exam_count) || 0,
      submissionCount: Number(q.submission_count) || 0,
    });
    setQForm({
      subjectId: q.subject_id,
      content: q.content,
      optionA: q.option_a,
      optionB: q.option_b,
      optionC: q.option_c,
      optionD: q.option_d,
      correctAnswer: q.correct_answer,
      difficulty: q.difficulty || "MEDIUM",
      explanation: q.explanation || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDeleteQuestion = async (id) => {
    const ok = await confirmDialog({
      title: "Xóa câu hỏi",
      message: `Bạn chắc chắn muốn xóa câu hỏi #${id}?`,
      confirmText: "Xóa câu hỏi",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await axiosClient.delete(`/questions/${id}`);
      setNotice({ type: "success", text: "🗑️ Đã xóa câu hỏi khỏi ngân hàng!" });
      loadAll();
    } catch (err) {
      setNotice({
        type: "error",
        text: err.response?.data?.message || "Lỗi xóa câu hỏi.",
      });
    }
  };

  const handleSaveSubject = async (e) => {
    e.preventDefault();
    if (saving) return;
    setNotice({ type: "", text: "" });
    setSaving(true);
    try {
      if (editingSId) {
        await axiosClient.put(`/subjects/${editingSId}`, sForm);
        setNotice({ type: "success", text: "✅ Cập nhật môn học thành công!" });
      } else {
        await axiosClient.post("/subjects", sForm);
        setNotice({ type: "success", text: "✅ Tạo môn học mới thành công!" });
      }
      setEditingSId(null);
      setSForm(emptySubject);
      loadAll();
    } catch (err) {
      setNotice({
        type: "error",
        text: err.response?.data?.message || "Lỗi lưu môn học.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEditSubject = (sub) => {
    setEditingSId(sub.id);
    setSForm({
      code: sub.code,
      name: sub.name,
      description: sub.description || "",
    });
  };

  const handleDeleteSubject = async (sub) => {
    const ok = await confirmDialog({
      title: "Xóa môn học",
      message: `Xóa môn học "${sub.name}"? Chỉ xóa được môn chưa có câu hỏi và đề thi.`,
      confirmText: "Xóa môn học",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await axiosClient.delete(`/subjects/${sub.id}`);
      setNotice({ type: "success", text: "🗑️ Đã xóa môn học thành công!" });
      loadAll();
    } catch (err) {
      setNotice({
        type: "error",
        text: err.response?.data?.message || "Không thể xóa môn học.",
      });
    }
  };

  const filteredQuestions = questions.filter((q) => {
    const matchSub = !filterSubject || Number(q.subject_id) === Number(filterSubject);
    const matchKey =
      !filterSearch ||
      q.content.toLowerCase().includes(filterSearch.trim().toLowerCase());
    return matchSub && matchKey;
  });

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

  const singleDuplicateWarning = useMemo(() => {
    const content = qForm.content.trim();
    if (!content || !qForm.subjectId) return null;
    const sameSubject = questions.filter(
      (q) =>
        Number(q.subject_id) === Number(qForm.subjectId) &&
        Number(q.id) !== Number(editingQId || 0)
    );
    for (const q of sameSubject) {
      const sim = computeTextSimilarity(content, q.content);
      if (sim >= 0.85) {
        return {
          code: questionCodeMap[q.id] || `#${q.id}`,
          percent: Math.round(sim * 100),
          content: q.content,
        };
      }
    }
    return null;
  }, [qForm.content, qForm.subjectId, editingQId, questions, questionCodeMap]);

  const bulkDuplicateMap = useMemo(() => {
    const map = {};
    if (!bulkSubjectId || previewQuestions.length === 0) return map;
    const sameSubject = questions.filter(
      (q) => Number(q.subject_id) === Number(bulkSubjectId)
    );
    for (const pq of previewQuestions) {
      if (!pq.content) continue;
      for (const existing of sameSubject) {
        const sim = computeTextSimilarity(pq.content, existing.content);
        if (sim >= 0.85) {
          map[pq.index] = {
            code: questionCodeMap[existing.id] || `#${existing.id}`,
            percent: Math.round(sim * 100),
          };
          break;
        }
      }
    }
    return map;
  }, [bulkSubjectId, previewQuestions, questions, questionCodeMap]);
  const groupedQuestions = useMemo(() => {
    const groups = new Map();
    for (const q of filteredQuestions) {
      const key = q.subject_id;
      if (!groups.has(key)) {
        groups.set(key, {
          subjectId: q.subject_id,
          subjectCode: q.subject_code,
          subjectName: q.subject_name,
          items: [],
        });
      }
      groups.get(key).items.push(q);
    }
    for (const group of groups.values()) {
      group.items.sort((a, b) => Number(a.id) - Number(b.id));
    }
    return Array.from(groups.values());
  }, [filteredQuestions]);

  const questionCountBySubject = useMemo(() => {
    const counts = {};
    for (const q of questions) {
      counts[q.subject_id] = (counts[q.subject_id] || 0) + 1;
    }
    return counts;
  }, [questions]);

  return (
    <div className="page-container">
      <div className="page-header-block">
        <div>
          <span className="section-badge">PHÂN HỆ ADMIN (CRUD)</span>
          <h1>Quản lý Học phần & Ngân hàng Câu hỏi</h1>
          <p>
            Biên soạn câu hỏi trắc nghiệm 4 lựa chọn, phân loại mức độ khó và
            quản lý danh mục môn học.
          </p>
        </div>

        <div className="tab-switcher">
          {isFromExamBuilder && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                const targetSubject = qForm.subjectId || filterSubject || initialSubjectId;
                navigate(
                  targetSubject
                    ? `/teacher/exams?subject_id=${targetSubject}`
                    : "/teacher/exams"
                );
              }}
            >
              ← Quay lại tạo đề thi
            </button>
          )}
          <button
            type="button"
            className={`tab-btn ${activeTab === "QUESTIONS" ? "active" : ""}`}
            onClick={() => setActiveTab("QUESTIONS")}
          >
            📝 Ngân hàng câu hỏi ({questions.length})
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "SUBJECTS" ? "active" : ""}`}
            onClick={() => setActiveTab("SUBJECTS")}
          >
            🏷️ Danh mục Môn học ({subjects.length})
          </button>
        </div>
      </div>

      {notice.text && (
        <div
          className={`alert-box notice-with-action ${
            notice.type === "error" ? "alert-error" : "alert-success"
          }`}
        >
          <span>{notice.text}</span>
          {notice.type === "success" && notice.subjectId && (
            <button
              type="button"
              className="btn-sm edit"
              onClick={() =>
                navigate(`/teacher/exams?subject_id=${notice.subjectId}`)
              }
            >
              Tạo đề thi từ môn này →
            </button>
          )}
        </div>
      )}

      {activeTab === "QUESTIONS" ? (
        <>

          <section className="panel-card compact-panel-card">
            <div className="panel-header">
              <h2>
                {editingQId
                  ? `✏️ Chỉnh sửa câu hỏi #${editingQId}`
                  : "➕ Thêm câu hỏi mới vào Ngân hàng đề"}
              </h2>
            </div>

            <form onSubmit={handleSaveQuestion} className="admin-form compact-admin-form">
              {editingQId && editingQuestionMeta.examCount > 0 && (
                <div className="exam-locked-banner" role="status" style={{ marginBottom: "4px" }}>
                  <span>
                    ⚠️ Câu hỏi này đang nằm trong{" "}
                    <strong>{editingQuestionMeta.examCount} đề thi</strong>
                    {editingQuestionMeta.submissionCount > 0
                      ? ` (${editingQuestionMeta.submissionCount} bài đã nộp)`
                      : ""}
                    . Mọi chỉnh sửa nội dung hoặc đáp án sẽ tự động đồng bộ vào đề thi và tính lại điểm cho các bài đã nộp.
                  </span>
                </div>
              )}

              <div className="form-row-3">
                <div className="form-field">
                  <div className="label-with-action">
                    <label>Môn học *</label>
                    {!editingQId && (
                      <button
                        type="button"
                        className="btn-link-inline"
                        onClick={openQuickSubjectModal}
                      >
                        + Thêm môn mới
                      </button>
                    )}
                  </div>
                  <select
                    value={qForm.subjectId}
                    disabled={Boolean(editingQId && editingQuestionMeta.examCount > 0)}
                    onChange={(e) => {
                      if (e.target.value === "__ADD_NEW__") {
                        openQuickSubjectModal();
                        return;
                      }
                      setQForm((p) => ({ ...p, subjectId: e.target.value }));
                    }}
                    required
                  >
                    <option value="">-- Chọn môn học --</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} - {s.name}
                      </option>
                    ))}
                    {!editingQId && (
                      <option value="__ADD_NEW__">➕ Thêm môn học mới...</option>
                    )}
                  </select>
                </div>

                <div className="form-field">
                  <label>Đáp án đúng *</label>
                  <select
                    value={qForm.correctAnswer}
                    onChange={(e) =>
                      setQForm((p) => ({ ...p, correctAnswer: e.target.value }))
                    }
                  >
                    <option value="A">Đáp án A</option>
                    <option value="B">Đáp án B</option>
                    <option value="C">Đáp án C</option>
                    <option value="D">Đáp án D</option>
                  </select>
                </div>

                <div className="form-field">
                  <label>Độ khó *</label>
                  <select
                    value={qForm.difficulty}
                    onChange={(e) =>
                      setQForm((p) => ({ ...p, difficulty: e.target.value }))
                    }
                  >
                    <option value="EASY">Dễ (Easy)</option>
                    <option value="MEDIUM">Trung bình (Medium)</option>
                    <option value="HARD">Khó (Hard)</option>
                  </select>
                </div>
              </div>

              <div className="form-field">
                <label>Nội dung câu hỏi *</label>
                <textarea
                  rows={2}
                  placeholder="Nhập câu hỏi trắc nghiệm..."
                  value={qForm.content}
                  onChange={(e) =>
                    setQForm((p) => ({ ...p, content: e.target.value }))
                  }
                  required
                />
                {singleDuplicateWarning && (
                  <span className="field-hint-error">
                    ⚠️ Cảnh báo trùng lặp ({singleDuplicateWarning.percent}% giống câu{" "}
                    {singleDuplicateWarning.code}): "{singleDuplicateWarning.content}"
                  </span>
                )}
              </div>

              <div className="form-row-2">
                <div className="form-field">
                  <label>Phương án A *</label>
                  <input
                    type="text"
                    placeholder="Nội dung đáp án A"
                    value={qForm.optionA}
                    onChange={(e) =>
                      setQForm((p) => ({ ...p, optionA: e.target.value }))
                    }
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Phương án B *</label>
                  <input
                    type="text"
                    placeholder="Nội dung đáp án B"
                    value={qForm.optionB}
                    onChange={(e) =>
                      setQForm((p) => ({ ...p, optionB: e.target.value }))
                    }
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Phương án C *</label>
                  <input
                    type="text"
                    placeholder="Nội dung đáp án C"
                    value={qForm.optionC}
                    onChange={(e) =>
                      setQForm((p) => ({ ...p, optionC: e.target.value }))
                    }
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Phương án D *</label>
                  <input
                    type="text"
                    placeholder="Nội dung đáp án D"
                    value={qForm.optionD}
                    onChange={(e) =>
                      setQForm((p) => ({ ...p, optionD: e.target.value }))
                    }
                    required
                  />
                </div>
              </div>

              <div className="form-row-explain-submit">
                <div className="form-field">
                  <label>Giải thích đáp án (Hiển thị sau khi sinh viên nộp bài)</label>
                  <input
                    type="text"
                    placeholder="Giải thích ngắn gọn lý do chọn đáp án đúng..."
                    value={qForm.explanation}
                    onChange={(e) =>
                      setQForm((p) => ({ ...p, explanation: e.target.value }))
                    }
                  />
                </div>

                <div className="explain-submit-actions">
                  {editingQId && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setEditingQId(null);
                        setEditingQuestionMeta({ examCount: 0, submissionCount: 0 });
                        setQForm({
                          ...emptyQuestion,
                          subjectId: subjects[0]?.id || "",
                        });
                      }}
                    >
                      Hủy sửa
                    </button>
                  )}
                  <button type="submit" className="btn-primary" disabled={saving}>
                    {editingQId ? "💾 Lưu cập nhật" : "➕ Lưu câu hỏi"}
                  </button>
                </div>
              </div>
            </form>
          </section>

          <section className="panel-card bulk-inline-section">
            <div className="panel-header-flex">
              <div>
                <span className="section-badge">SMART TEXT PARSER</span>
                <h2 style={{ marginTop: "4px" }}>⚡ Nhập nhanh hàng loạt từ văn bản</h2>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setBulkSectionOpen((prev) => !prev)}
              >
                {bulkSectionOpen ? "▼ Thu gọn" : "▶ Mở rộng"}
              </button>
            </div>

            {bulkSectionOpen && (
              <div className="bulk-inline-body">
                {bulkError && (
                  <div className="alert-box alert-error">⚠️ {bulkError}</div>
                )}

                <div className="bulk-modal-grid">
                  <div className="bulk-col-left">
                    <div className="form-row-2">
                      <div className="form-field">
                        <div className="label-with-action">
                          <label>Môn học *</label>
                          <button
                            type="button"
                            className="btn-link-inline"
                            onClick={openQuickSubjectModal}
                          >
                            + Thêm môn mới
                          </button>
                        </div>
                        <select
                          value={bulkSubjectId}
                          onChange={(e) => {
                            if (e.target.value === "__ADD_NEW__") {
                              openQuickSubjectModal();
                              return;
                            }
                            setBulkSubjectId(e.target.value);
                          }}
                        >
                          <option value="">-- Chọn môn học --</option>
                          {subjects.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.code} - {s.name}
                            </option>
                          ))}
                          <option value="__ADD_NEW__">➕ Thêm môn học mới...</option>
                        </select>
                      </div>

                      <div className="form-field">
                        <label>Mức độ mặc định</label>
                        <select
                          value={bulkDifficulty}
                          onChange={(e) => setBulkDifficulty(e.target.value)}
                        >
                          <option value="EASY">Dễ (Easy)</option>
                          <option value="MEDIUM">Trung bình (Medium)</option>
                          <option value="HARD">Khó (Hard)</option>
                        </select>
                      </div>
                    </div>

                    <div className="bulk-toolbar">
                      <label htmlFor="bulk-textarea">Dán nội dung đề thi vào đây *</label>
                      <div className="bulk-toolbar-actions">
                        <button
                          type="button"
                          className="btn-sm edit"
                          onClick={() => setBulkText(SAMPLE_BULK_QUESTIONS)}
                        >
                          📋 Dán dữ liệu mẫu
                        </button>
                        {bulkText && (
                          <button
                            type="button"
                            className="btn-sm delete"
                            onClick={() => setBulkText("")}
                          >
                            Xóa trắng
                          </button>
                        )}
                      </div>
                    </div>

                    <textarea
                      id="bulk-textarea"
                      className="bulk-textarea"
                      rows={12}
                      placeholder={`Câu 1: Nội dung câu hỏi...\nA. Đáp án A\nB. Đáp án B\nC. Đáp án C\nD. Đáp án D\nĐáp án: B\nGiải thích: (tùy chọn)`}
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                    />
                  </div>

                  <div className="bulk-col-right">
                    <div className="bulk-preview-header">
                      <strong>Xem trước kết quả phân tích (Live Preview)</strong>
                      <div className="bulk-stats-pills">
                        <span className="bulk-pill total">
                          Tổng: {previewQuestions.length}
                        </span>
                        <span className="bulk-pill valid">
                          Hợp lệ: {validBulkQuestions.length}
                        </span>
                        {invalidBulkCount > 0 && (
                          <span className="bulk-pill invalid">
                            Lỗi: {invalidBulkCount}
                          </span>
                        )}
                      </div>
                    </div>

                    {invalidBulkCount > 0 && (
                      <div className="bulk-error-banner" role="alert">
                        <strong>
                          ⚠️ Phát hiện {invalidBulkCount} câu lỗi (
                          {invalidBulkQuestions.map((q) => `Câu ${q.index}`).join(", ")}):
                        </strong>{" "}
                        {invalidBulkQuestions
                          .map((q) => `Câu ${q.index}: ${q.errors.join("; ")}`)
                          .join(" | ")}
                        . Hãy bấm chọn đáp án đúng A/B/C/D trực tiếp trên thẻ hoặc xóa câu lỗi trước khi lưu.
                      </div>
                    )}

                    <div className="bulk-preview-list">
                      {previewQuestions.length === 0 ? (
                        <div className="bulk-preview-empty">
                          <p>Chưa có dữ liệu. Hãy dán văn bản đề thi ở cột trái hoặc bấm <strong>"Dán dữ liệu mẫu"</strong>.</p>
                        </div>
                      ) : (
                        previewQuestions.map((q) => {
                          const opts = [
                            { key: "A", text: q.optionA },
                            { key: "B", text: q.optionB },
                            { key: "C", text: q.optionC },
                            { key: "D", text: q.optionD },
                          ];
                          return (
                            <article
                              key={q.index}
                              className={`bulk-preview-card ${q.isValid ? "valid" : "invalid"}`}
                            >
                              <div className="bulk-card-top">
                                <span className="bulk-card-num">Câu {q.index}</span>
                                <div className="bulk-card-actions">
                                  <span className={`bulk-card-status ${q.isValid ? "ok" : "err"}`}>
                                    {q.isValid ? "✓ Hợp lệ" : "✕ Thiếu / Sai định dạng"}
                                  </span>
                                  <button
                                    type="button"
                                    className="btn-remove-preview"
                                    onClick={() => handleRemovePreviewQuestion(q.index)}
                                  >
                                    ✕ Xóa câu này
                                  </button>
                                </div>
                              </div>

                              <p className="bulk-card-content">
                                {q.content || <em>(Chưa có nội dung câu hỏi)</em>}
                              </p>

                              <div className="bulk-preview-options">
                                {opts.map((opt) => {
                                  const isCorrect = q.correctAnswer === opt.key;
                                  return (
                                    <button
                                      key={opt.key}
                                      type="button"
                                      className={`bulk-opt-item ${isCorrect ? "correct" : ""} ${!opt.text ? "missing" : ""}`}
                                      title={`Bấm để chọn ${opt.key} là đáp án đúng`}
                                      onClick={() => handleSelectPreviewAnswer(q.index, opt.key)}
                                    >
                                      <span className="bulk-opt-key">{opt.key}</span>
                                      <span>{opt.text || "(Trống)"}</span>
                                      {isCorrect && (
                                        <span className="bulk-opt-check">✓ Đúng</span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>

                              {q.explanation && (
                                <div className="bulk-card-exp">
                                  <strong>💡 Giải thích:</strong> {q.explanation}
                                </div>
                              )}

                              {bulkDuplicateMap[q.index] && (
                                <div className="bulk-card-errors" style={{ background: "var(--amber-light)", color: "#fef3c7" }}>
                                  ⚠️ Cảnh báo trùng lặp ({bulkDuplicateMap[q.index].percent}% giống câu{" "}
                                  <strong>{bulkDuplicateMap[q.index].code}</strong> đã có trong ngân hàng)
                                </div>
                              )}

                              {!q.isValid && (
                                <div className="bulk-card-errors">
                                  {q.errors.map((err, i) => (
                                    <div key={i}>• {err}</div>
                                  ))}
                                </div>
                              )}
                            </article>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                <div className="bulk-modal-footer">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={
                      bulkSaving ||
                      !bulkSubjectId ||
                      validBulkQuestions.length === 0 ||
                      invalidBulkCount > 0
                    }
                    onClick={handleBulkSave}
                  >
                    {bulkSaving
                      ? "Đang lưu..."
                      : invalidBulkCount > 0
                      ? `⚠️ Xử lý hết ${invalidBulkCount} câu lỗi để lưu`
                      : `💾 Lưu ${validBulkQuestions.length} câu hỏi hợp lệ`}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="panel-card">
            <div className="panel-header-flex">
              <div>
                <h2>Danh sách câu hỏi ({filteredQuestions.length})</h2>
                <div className="q-usage-legend">
                  <span>
                    <i className="q-usage-dot used" /> Đã có trong đề thi
                  </span>
                  <span>
                    <i className="q-usage-dot unused" /> Chưa sử dụng
                  </span>
                </div>
              </div>
              <div className="inline-filters">
                <input
                  type="text"
                  placeholder="Tìm nội dung câu hỏi..."
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="subject-pills-wrap" style={{ marginBottom: "16px" }}>
              <button
                type="button"
                className={`filter-pill ${filterSubject === "" ? "active" : ""}`}
                onClick={() => setFilterSubject("")}
              >
                Tất cả ({questions.length})
              </button>
              {subjects.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`filter-pill ${
                    Number(filterSubject) === Number(s.id) ? "active" : ""
                  }`}
                  onClick={() => setFilterSubject(String(s.id))}
                >
                  {s.code} - {s.name} ({questionCountBySubject[s.id] || 0})
                </button>
              ))}
            </div>

            {loading ? (
              <div className="loading-box">Đang tải...</div>
            ) : groupedQuestions.length === 0 ? (
              <div className="empty-box">
                <div className="empty-emoji">📭</div>
                <h3>Không có câu hỏi phù hợp</h3>
                <p>Hãy thử chọn môn học khác hoặc thêm câu hỏi mới.</p>
              </div>
            ) : (
              <div className="subject-groups-stack">
                {groupedQuestions.map((group) => {
                  const isCollapsed = Boolean(collapsedSubjects[group.subjectId]);
                  return (
                    <div key={group.subjectId} className="subject-group-block">
                      <button
                        type="button"
                        className="subject-group-header"
                        onClick={() => toggleSubjectCollapse(group.subjectId)}
                      >
                        <div className="subject-group-title">
                          <span className="code-badge">{group.subjectCode}</span>
                          <strong>{group.subjectName}</strong>
                          <span className="subject-group-count">
                            {group.items.length} câu hỏi
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
                                <th style={{ width: "120px" }}>Mã câu</th>
                                <th>Câu hỏi & 4 Phương án</th>
                                <th style={{ width: "90px" }}>Đáp án</th>
                                <th style={{ width: "160px", textAlign: "right" }}>
                                  Thao tác
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.items.map((q) => {
                                const isUsed = Number(q.exam_count) > 0;
                                return (
                                  <tr key={q.id}>
                                    <td>
                                      <span className="q-code-with-dot">
                                        <span className="code-badge">
                                          {questionCodeMap[q.id]}
                                        </span>
                                        <span
                                          className={`q-usage-dot ${isUsed ? "used" : "unused"}`}
                                          title={
                                            isUsed
                                              ? "Đã được chọn vào đề thi"
                                              : "Chưa được chọn vào đề nào"
                                          }
                                        />
                                      </span>
                                    </td>
                                    <td>
                                      <strong>{q.content}</strong>
                                      <div className="mini-options-row">
                                        <span>A. {q.option_a}</span>
                                        <span>B. {q.option_b}</span>
                                        <span>C. {q.option_c}</span>
                                        <span>D. {q.option_d}</span>
                                      </div>
                                    </td>
                                    <td>
                                      <span className="correct-badge">{q.correct_answer}</span>
                                    </td>
                                    <td style={{ textAlign: "right" }}>
                                      <div className="action-btn-group">
                                        <button
                                          type="button"
                                          className="btn-sm edit"
                                          onClick={() => handleEditQuestion(q)}
                                        >
                                          Sửa
                                        </button>
                                        <button
                                          type="button"
                                          className="btn-sm delete"
                                          onClick={() => handleDeleteQuestion(q.id)}
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
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : (

        <>
          <section className="panel-card">
            <div className="panel-header">
              <h2>
                {editingSId ? "✏️ Cập nhật Môn học" : "➕ Thêm Môn học mới"}
              </h2>
            </div>

            <form onSubmit={handleSaveSubject} className="admin-form">
              <div className="form-row-2">
                <div className="form-field">
                  <label>Mã học phần (VD: INT1434) *</label>
                  <input
                    type="text"
                    placeholder="INT1434"
                    value={sForm.code}
                    onChange={(e) =>
                      setSForm((p) => ({ ...p, code: e.target.value }))
                    }
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Tên môn học *</label>
                  <input
                    type="text"
                    placeholder="Lập trình Web"
                    value={sForm.name}
                    onChange={(e) =>
                      setSForm((p) => ({ ...p, name: e.target.value }))
                    }
                    required
                  />
                </div>
              </div>

              <div className="form-field">
                <label>Mô tả học phần</label>
                <input
                  type="text"
                  placeholder="Mô tả tóm tắt nội dung môn học..."
                  value={sForm.description}
                  onChange={(e) =>
                    setSForm((p) => ({ ...p, description: e.target.value }))
                  }
                />
              </div>

              <div className="form-actions-right">
                {editingSId && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setEditingSId(null);
                      setSForm(emptySubject);
                    }}
                  >
                    Hủy
                  </button>
                )}
                <button type="submit" className="btn-primary" disabled={saving}>
                  {editingSId ? "💾 Lưu cập nhật" : "➕ Tạo môn học"}
                </button>
              </div>
            </form>
          </section>

          <section className="panel-card">
            <div className="panel-header">
              <h2>Danh sách các Môn học ({subjects.length})</h2>
            </div>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mã HP</th>
                    <th>Tên môn học</th>
                    <th>Mô tả</th>
                    <th>Số câu hỏi</th>
                    <th>Số đề thi</th>
                    <th style={{ textAlign: "right" }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {subjects.map((sub) => (
                    <tr key={sub.id}>
                      <td>
                        <span className="code-badge">{sub.code}</span>
                      </td>
                      <td>
                        <strong>{sub.name}</strong>
                      </td>
                      <td>{sub.description}</td>
                      <td>{sub.question_count} câu</td>
                      <td>{sub.exam_count} đề</td>
                      <td style={{ textAlign: "right" }}>
                        <div className="action-btn-group">
                          <button
                            type="button"
                            className="btn-sm edit"
                            onClick={() => handleEditSubject(sub)}
                          >
                            Sửa
                          </button>
                          <button
                            type="button"
                            className="btn-sm delete"
                            onClick={() => handleDeleteSubject(sub)}
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <QuickSubjectModal
        open={showQuickSubjectModal}
        form={quickSubjectForm}
        onChange={setQuickSubjectForm}
        error={quickSubjectError}
        saving={quickSubjectSaving}
        onClose={closeQuickSubjectModal}
        onSubmit={handleQuickCreateSubject}
      />
    </div>
  );
}
