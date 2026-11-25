import { createPortal } from "react-dom";

const QUICK_SUSPEND_REASONS = [
  "Vi phạm quy chế phòng thi",
  "Rời tab / Thoát toàn màn hình quá giới hạn",
  "Sử dụng tài liệu / DevTools",
];

export default function SuspendExamModal({
  target,
  reason,
  onReasonChange,
  submitting,
  onClose,
  onSubmit,
}) {
  if (!target) return null;

  return createPortal(
    <div
      className="custom-modal-backdrop"
      onClick={() => !submitting && onClose()}
    >
      <form
        className="custom-modal-card danger-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Xác nhận Đình chỉ bài thi"
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className="custom-modal-header">
          <h3>🚫 Xác nhận Đình chỉ bài thi (0 điểm)</h3>
          <button
            type="button"
            className="custom-modal-close"
            disabled={submitting}
            onClick={onClose}
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        <div className="suspend-student-info">
          <div>
            <strong>{target.fullName}</strong>
            {target.studentCode ? ` • Mã SV: ${target.studentCode}` : ""}
          </div>
          <span>0.00 điểm</span>
        </div>

        <div className="form-field">
          <label>Chọn nhanh lý do phổ biến</label>
          <div className="quick-reason-chips">
            {QUICK_SUSPEND_REASONS.map((item) => (
              <button
                key={item}
                type="button"
                className={`quick-reason-chip ${reason === item ? "active" : ""}`}
                onClick={() => onReasonChange(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="form-field">
          <label>Lý do chi tiết *</label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="Nhập lý do đình chỉ bài thi..."
            required
          />
        </div>

        <div className="custom-modal-footer">
          <button
            type="button"
            className="btn-secondary"
            disabled={submitting}
            onClick={onClose}
          >
            Hủy bỏ
          </button>
          <button
            type="submit"
            className="btn-danger-solid"
            disabled={submitting}
          >
            {submitting ? "Đang xử lý..." : "🚫 Xác nhận đình chỉ (0đ)"}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
