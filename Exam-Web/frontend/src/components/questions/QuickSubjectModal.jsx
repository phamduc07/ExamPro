import { createPortal } from "react-dom";

export default function QuickSubjectModal({
  open,
  form,
  onChange,
  error,
  saving,
  onClose,
  onSubmit,
}) {
  if (!open) return null;

  return createPortal(
    <div
      className="bulk-modal-backdrop"
      style={{ zIndex: 10050 }}
      onClick={onClose}
    >
      <div
        className="bulk-modal-card quick-subject-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Thêm môn học mới"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bulk-modal-header">
          <div>
            <span className="section-badge">DANH MỤC HỌC PHẦN</span>
            <h2>➕ Thêm môn học mới</h2>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            ✕ Đóng
          </button>
        </div>

        {error && <div className="alert-box alert-error">⚠️ {error}</div>}

        <form onSubmit={onSubmit} className="admin-form">
          <div className="form-field">
            <label htmlFor="quick-sub-code">Mã môn học *</label>
            <input
              id="quick-sub-code"
              type="text"
              placeholder="VD: BAS1150 hoặc INT1408"
              value={form.code}
              onChange={(e) =>
                onChange((p) => ({
                  ...p,
                  code: e.target.value.toUpperCase(),
                }))
              }
              required
            />
          </div>

          <div className="form-field">
            <label htmlFor="quick-sub-name">Tên môn học *</label>
            <input
              id="quick-sub-name"
              type="text"
              placeholder="VD: Triết học Mác - Lênin"
              value={form.name}
              onChange={(e) =>
                onChange((p) => ({ ...p, name: e.target.value }))
              }
              required
            />
          </div>

          <div className="form-field">
            <label htmlFor="quick-sub-desc">Mô tả ngắn (tùy chọn)</label>
            <input
              id="quick-sub-desc"
              type="text"
              placeholder="Nhập mô tả tóm tắt học phần..."
              value={form.description}
              onChange={(e) =>
                onChange((p) => ({
                  ...p,
                  description: e.target.value,
                }))
              }
            />
          </div>

          <div className="bulk-modal-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Hủy
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Đang lưu..." : "💾 Lưu môn học"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
