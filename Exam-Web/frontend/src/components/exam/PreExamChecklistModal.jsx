import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function PreExamChecklistModal({
  open,
  exam,
  onClose,
  onConfirmStart,
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    if (open) {
      setConfirmed(false);
    }
  }, [open, exam?.id]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!open) return null;

  const isAntiCheat = Boolean(Number(exam?.anti_cheat));
  const maxSwitches =
    Number(exam?.max_tab_switches) >= 1 ? Number(exam.max_tab_switches) : 3;

  return createPortal(
    <div className="custom-modal-backdrop" role="presentation">
      <div
        className="custom-modal-card pre-exam-checklist-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pre-exam-checklist-title"
      >
        <div className="custom-modal-header">
          <div>
            <span className="section-badge">CHECKLIST AN TOÀN TRƯỚC GIỜ THI</span>
            <h3 id="pre-exam-checklist-title" style={{ marginTop: "6px" }}>
              🛡️ Kiểm tra thiết bị & Môi trường làm bài
            </h3>
          </div>
          {onClose && (
            <button
              type="button"
              className="custom-modal-close"
              onClick={onClose}
              aria-label="Đóng"
            >
              ✕
            </button>
          )}
        </div>

        <p className="checklist-intro-note">
          Để tránh bị gián đoạn hoặc ghi nhận vi phạm đáng tiếc trong ca thi
          {exam?.title ? ` "${exam.title}"` : ""}, vui lòng kiểm tra kỹ 4 mục dưới đây:
        </p>

        <div className="pre-exam-checklist-items">
          <div className="checklist-row-card">
            <span className="checklist-row-icon">🔕</span>
            <div className="checklist-row-body">
              <strong>Tắt thông báo Zalo, Messenger & ứng dụng chạy ngầm</strong>
              <span>
                Thoát hoàn toàn Zalo PC, Messenger, Telegram, Discord hoặc tắt thông báo nổi để tránh popup chiếm quyền điều khiển cửa sổ.
              </span>
            </div>
          </div>

          <div className="checklist-row-card">
            <span className="checklist-row-icon">🌙</span>
            <div className="checklist-row-body">
              <strong>Bật chế độ Focus Assist / Không làm phiền</strong>
              <span>
                Bật <em>Focus Assist (Do Not Disturb)</em> trên Windows hoặc macOS để chặn thông báo hệ thống và cập nhật tự động khi đang làm bài.
              </span>
            </div>
          </div>

          <div className="checklist-row-card">
            <span className="checklist-row-icon">🌐</span>
            <div className="checklist-row-body">
              <div className="checklist-net-head">
                <strong>Kiểm tra kết nối mạng ổn định</strong>
                <span className={`tab-switch-badge ${isOnline ? "safe" : "danger"}`}>
                  {isOnline ? "🟢 Đang trực tuyến" : "🔴 Mất kết nối"}
                </span>
              </div>
              <span>
                Đảm bảo Wi-Fi / mạng dây và nguồn điện ổn định để hệ thống tự động lưu đáp án và nộp bài chính xác.
              </span>
            </div>
          </div>

          <div className="checklist-row-card">
            <span className="checklist-row-icon">⛶</span>
            <div className="checklist-row-body">
              <strong>Xác nhận vào chế độ Toàn màn hình (Fullscreen)</strong>
              <span>
                {isAntiCheat
                  ? `Đề thi bật giám sát Anti-Cheat (tối đa ${maxSwitches} lần vi phạm). Chuyển tab, thu nhỏ trình duyệt hoặc thoát Toàn màn hình sẽ tính lỗi ngay lập tức; mất focus cửa sổ quá 3 giây tính 1 lần vi phạm.`
                  : "Trình duyệt sẽ chuyển sang chế độ Toàn màn hình để tối ưu không gian tập trung làm bài."}
              </span>
            </div>
          </div>
        </div>

        <label className="checklist-confirm-box">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            Tôi xác nhận đã tắt thông báo Zalo/Messenger, bật chế độ Không làm phiền, kiểm tra kết nối mạng ổn định và sẵn sàng vào chế độ Toàn màn hình.
          </span>
        </label>

        <div className="custom-modal-footer">
          {onClose && (
            <button type="button" className="btn-secondary" onClick={onClose}>
              Quay lại
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={!confirmed || !isOnline}
            onClick={onConfirmStart}
          >
            🚀 Bắt đầu làm bài
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
