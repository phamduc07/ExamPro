import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axiosClient from "../../api/axiosClient";
import { useAuth } from "../../context/AuthContext";
import { useExamStore } from "../../store/useExamStore";
import AdminExamMonitor from "../../components/AdminExamMonitor";

export default function HomePage() {
  const { user } = useAuth();
  if (user?.role === "TEACHER" || user?.role === "ADMIN") {
    return <AdminExamMonitor />;
  }
  return <StudentHomePage />;
}

function StudentHomePage() {
  const { user } = useAuth();
  const {
    selectedSubjectId,
    searchQuery,
    setSelectedSubjectId,
    setSearchQuery,
  } = useExamStore();

  const [exams, setExams] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [mySubmissions, setMySubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [collapsedSubjects, setCollapsedSubjects] = useState({});

  useEffect(() => {
    async function loadDashboardData() {
      setLoading(true);
      try {
        const [examRes, subRes, histRes] = await Promise.all([
          axiosClient.get("/exams?publishedOnly=true"),
          axiosClient.get("/subjects"),
          axiosClient.get("/submissions/my-history"),
        ]);
        setExams(examRes.data.data || []);
        setSubjects(subRes.data.data || []);
        setMySubmissions(histRes.data.data || []);
      } catch (err) {
        setError(err.response?.data?.message || "Không thể tải dữ liệu. Vui lòng kiểm tra kết nối và tải lại trang.");
      } finally {
        setLoading(false);
      }
    }
    loadDashboardData();
  }, []);

  const filteredExams = exams.filter((exam) => {
    const matchSubject =
      !selectedSubjectId || Number(exam.subject_id) === Number(selectedSubjectId);
    const keyword = searchQuery.trim().toLowerCase();
    const matchSearch =
      !keyword ||
      exam.title.toLowerCase().includes(keyword) ||
      exam.subject_name?.toLowerCase().includes(keyword) ||
      exam.subject_code?.toLowerCase().includes(keyword);
    return matchSubject && matchSearch;
  });

  const sortedSubjects = useMemo(
    () =>
      [...subjects].sort((a, b) =>
        String(a.code || "").localeCompare(String(b.code || ""))
      ),
    [subjects]
  );

  const groupedFilteredExams = useMemo(() => {
    const map = new Map();
    for (const exam of filteredExams) {
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
  }, [filteredExams]);

  const toggleSubjectCollapse = (subjectCode) => {
    setCollapsedSubjects((prev) => ({
      ...prev,
      [subjectCode]: !prev[subjectCode],
    }));
  };

  const avgScore =
    mySubmissions.length > 0
      ? (
          mySubmissions.reduce((acc, cur) => acc + Number(cur.score), 0) /
          mySubmissions.length
        ).toFixed(2)
      : "—";

  const bestScore =
    mySubmissions.length > 0
      ? Math.max(...mySubmissions.map((s) => Number(s.score))).toFixed(2)
      : "—";

  return (
    <div className="page-container">
      {error && <div className="alert-box alert-error">{error} <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>Thử lại</button></div>}

      <section className="hero-banner">
        <div className="hero-banner-text">
          <span className="banner-pill">
            ✨ HỌC KỲ I NĂM HỌC 2026 - 2027 • PTIT EXAMPRO
          </span>
          <h1>Xin chào! 👋</h1>
          <p>
            Chào mừng bạn đến với cổng thi trắc nghiệm trực tuyến. Hãy lựa chọn học
            phần bên dưới để bắt đầu làm bài kiểm tra định kỳ hoặc luyện tập củng cố
            kiến thức.
          </p>
        </div>

        {user?.role === "TEACHER" && (
          <div className="hero-banner-actions">
            <Link to="/teacher/questions" className="btn-glass">
              🗂️ Quản lý Ngân hàng câu hỏi
            </Link>
            <Link to="/teacher/exams" className="btn-white">
              ➕ Tạo Đề thi mới
            </Link>
          </div>
        )}
      </section>

      <section className="stats-row">
        <div className="stat-box">
          <div className="stat-icon indigo">📚</div>
          <div>
            <span className="stat-label">Đề thi đang mở</span>
            <strong className="stat-value">{exams.length} đề</strong>
          </div>
        </div>

        <div className="stat-box">
          <div className="stat-icon crimson">🏷️</div>
          <div>
            <span className="stat-label">Học phần đào tạo</span>
            <strong className="stat-value">{subjects.length} môn</strong>
          </div>
        </div>

        <div className="stat-box">
          <div className="stat-icon emerald">✅</div>
          <div>
            <span className="stat-label">Bài thi bạn đã nộp</span>
            <strong className="stat-value">{mySubmissions.length} lượt</strong>
          </div>
        </div>

        <div className="stat-box">
          <div className="stat-icon amber">🏆</div>
          <div>
            <span className="stat-label">Điểm TB / Cao nhất</span>
            <strong className="stat-value">
              {avgScore} / {bestScore}
            </strong>
          </div>
        </div>
      </section>

      <section className="filter-bar">
        <div className="search-input-wrap">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Tìm kiếm theo tên đề thi, tên môn học hoặc mã học phần (VD: INT1434)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="btn-clear"
              onClick={() => setSearchQuery("")}
            >
              ✕
            </button>
          )}
        </div>

        <div className="subject-pills-wrap">
          <button
            type="button"
            className={`filter-pill ${selectedSubjectId === "" ? "active" : ""}`}
            onClick={() => setSelectedSubjectId("")}
          >
            Tất cả môn ({exams.length})
          </button>
          {sortedSubjects.map((sub) => {
            const subCount = exams.filter(
              (ex) => Number(ex.subject_id) === Number(sub.id)
            ).length;
            return (
              <button
                key={sub.id}
                type="button"
                className={`filter-pill ${
                  Number(selectedSubjectId) === Number(sub.id) ? "active" : ""
                }`}
                onClick={() => setSelectedSubjectId(sub.id)}
              >
                {sub.code} - {sub.name} ({subCount})
              </button>
            );
          })}
        </div>
      </section>

      <section className="exam-list-section">
        <div className="section-header-row">
          <h2>Danh sách đề thi trực tuyến ({filteredExams.length})</h2>
        </div>

        {loading ? (
          <div className="loading-box">Đang tải danh sách đề thi...</div>
        ) : error ? null : filteredExams.length === 0 ? (
          <div className="empty-box">
            <div className="empty-emoji">📭</div>
            <h3>Không tìm thấy đề thi phù hợp</h3>
            <p>Thử thay đổi từ khóa tìm kiếm hoặc chọn môn học khác.</p>
          </div>
        ) : (
          <div className="subject-groups-stack">
            {groupedFilteredExams.map((group) => {
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
                        <article key={exam.id} className="exam-card">
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
                              {exam.major_group === "KY_THUAT"
                                ? "⚙️ Khối Kỹ thuật"
                                : exam.major_group === "KINH_TE"
                                ? "📈 Khối Kinh tế"
                                : "🌐 Đề chung"}
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
                          <p className="exam-card-desc">
                            {exam.description ||
                              "Đề thi trắc nghiệm chuẩn hóa đánh giá năng lực học phần."}
                          </p>

                          <div className="exam-card-specs">
                            <div className="spec-pill">
                              <span>⏱️ Thời lượng:</span>
                              <strong>{exam.duration_minutes} phút</strong>
                            </div>
                            <div className="spec-pill">
                              <span>📝 Số câu:</span>
                              <strong>{exam.question_count} câu</strong>
                            </div>
                            <div className="spec-pill">
                              <span>🎯 Điểm đạt:</span>
                              <strong>{exam.pass_score}/10</strong>
                            </div>
                            <div className="spec-pill">
                              <span>👁️ Rời tab:</span>
                              <strong>
                                {exam.max_tab_switches === null ||
                                exam.max_tab_switches === undefined
                                  ? "Không giới hạn"
                                  : Number(exam.max_tab_switches) === 0
                                  ? "0 lần (Nghiêm ngặt - Cấm rời tab)"
                                  : `${exam.max_tab_switches} lần`}
                              </strong>
                            </div>
                            <div className="spec-pill">
                              <span>🔁 Lượt thi:</span>
                              <strong>
                                {exam.max_attempts === null ||
                                exam.max_attempts === undefined
                                  ? "Không giới hạn"
                                  : `${exam.max_attempts} lượt`}
                              </strong>
                            </div>
                            {Boolean(exam.anti_cheat) && (
                              <span className="tab-switch-badge danger">
                                🛡️ Giám sát Anti-Cheat
                              </span>
                            )}
                          </div>

                          <div className="exam-card-footer">
                            <Link to={`/exams/${exam.id}`} className="btn-enter-exam">
                              Chi tiết & Vào thi →
                            </Link>
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
    </div>
  );
}
