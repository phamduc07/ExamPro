import { createPortal } from "react-dom";

export default function ExamPreviewModal({
  open,
  onClose,
  form,
  selectedQuestionObjects,
  questionCodeMap,
}) {
  if (!open) return null;

  return createPortal(
    <div className="bulk-modal-backdrop" onClick={onClose}>
      <div
        className="bulk-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Xem trước đề thi"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bulk-modal-header">
          <div>
            <span className="section-badge">XEM TRƯỚC ĐỀ THI</span>
            <h2>{form.title || "(Chưa nhập tiêu đề đề thi)"}</h2>
            <p className="sub-text">
              ⏱️ {form.durationMinutes} phút • 📝 {selectedQuestionObjects.length} câu • 🎯 Điểm đạt: {form.passScore}/10
              {form.shuffleQuestions ? " • 🔀 Trộn câu hỏi" : ""}
              {form.shuffleOptions ? " • 🔀 Trộn đáp án" : ""}
              {form.maxTabSwitches !== null
                ? Number(form.maxTabSwitches) === 0
                  ? " • 🛡️ 0 lần rời tab (Nghiêm ngặt)"
                  : ` • 🛡️ Tối đa ${form.maxTabSwitches} lần rời tab`
                : " • 🛡️ Rời tab: Không giới hạn"}
              {form.maxAttempts !== null && Number(form.maxAttempts) >= 1
                ? ` • 🔁 Tối đa ${form.maxAttempts} lượt`
                : " • 🔁 Lượt thi: Không giới hạn"}
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            ✕ Đóng
          </button>
        </div>

        <div className="bulk-preview-list" style={{ maxHeight: "65vh" }}>
          {selectedQuestionObjects.map((q, idx) => {
            const opts = [
              { key: "A", text: q.option_a },
              { key: "B", text: q.option_b },
              { key: "C", text: q.option_c },
              { key: "D", text: q.option_d },
            ];
            return (
              <article key={q.id} className="bulk-preview-card valid">
                <div className="bulk-card-top">
                  <span className="bulk-card-num">
                    Câu {idx + 1} • {questionCodeMap[q.id]}
                  </span>
                  <span className="bulk-card-status ok">
                    Đáp án đúng: {q.correct_answer}
                  </span>
                </div>
                <p className="bulk-card-content">{q.content}</p>
                <div className="bulk-preview-options">
                  {opts.map((opt) => {
                    const isCorrect = q.correct_answer === opt.key;
                    return (
                      <div
                        key={opt.key}
                        className={`bulk-opt-item ${isCorrect ? "correct" : ""}`}
                      >
                        <span className="bulk-opt-key">{opt.key}</span>
                        <span>{opt.text}</span>
                        {isCorrect && <span className="bulk-opt-check">✓ Đúng</span>}
                      </div>
                    );
                  })}
                </div>
                {q.explanation && (
                  <div className="bulk-card-exp">
                    <strong>💡 Giải thích:</strong> {q.explanation}
                  </div>
                )}
              </article>
            );
          })}
        </div>

        <div className="bulk-modal-footer">
          <button type="button" className="btn-primary" onClick={onClose}>
            Đóng xem trước
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
