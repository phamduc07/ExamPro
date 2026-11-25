import { createPortal } from "react-dom";

export default function ReopenAttemptModal({
  target,
  submitting,
  onClose,
  onConfirm,
}) {
  if (!target) return null;

  return createPortal(
    <div
      className="custom-modal-backdrop"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="custom-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Xác nhận Gỡ vi phạm và Mở lại lượt thi"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="custom-modal-header">
          <h3>🔓 Xác nhận Gỡ vi phạm & Mở lại lượt thi</h3>
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

        <div
          className="zalo-appeal-box"
          style={{ gap: "6px", padding: "12px 14px" }}
        >
          <div style={{ color: "#ffffff", fontWeight: 700, fontSize: "0.9rem" }}>
            👤 {target.fullName}
            {target.studentCode ? ` • Mã SV: ${target.studentCode}` : ""}
          </div>
          {target.examTitle && (
            <div style={{ color: "#7dd3fc", fontSize: "0.84rem", fontWeight: 600 }}>
              📝 Đề thi: {target.examTitle}
            </div>
          )}
        </div>

        <p className="custom-modal-body">
          Thao tác này sẽ xóa trạng thái vi phạm/đình chỉ hiện tại và cấp lại 1 lượt làm bài mới cho sinh viên.
        </p>

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
            type="button"
            className="btn-primary"
            disabled={submitting}
            onClick={onConfirm}
          >
            {submitting ? "Đang xử lý..." : "🔓 Xác nhận mở lại lượt"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
