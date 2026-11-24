import { createContext, useCallback, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const ZALO_ADMIN_PHONE = "0397688237";
export const ZALO_ADMIN_URL = `https://zalo.me/${ZALO_ADMIN_PHONE}`;

const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const confirmResolverRef = useRef(null);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message, type = "info", duration = 4200) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, message, type }]);
      if (duration > 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);
      }
    },
    []
  );

  const confirmDialog = useCallback((options) => {
    const normalized =
      typeof options === "string"
        ? { title: "Xác nhận thao tác", message: options }
        : options || {};
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmState({
        title: normalized.title || "Xác nhận thao tác",
        message: normalized.message || "",
        confirmText: normalized.confirmText || "Xác nhận",
        cancelText: normalized.cancelText || "Hủy bỏ",
        tone: normalized.tone || "primary",
      });
    });
  }, []);

  const handleConfirmChoice = (accepted) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmState(null);
    if (resolver) resolver(accepted);
  };

  return (
    <DialogContext.Provider value={{ showToast, confirmDialog }}>
      {children}

      {toasts.length > 0 &&
        createPortal(
          <div className="toast-viewport" role="region" aria-label="Thông báo">
            {toasts.map((toast) => (
              <div
                key={toast.id}
                className={`toast-card toast-${toast.type}`}
                role="status"
              >
                <span className="toast-icon" aria-hidden="true">
                  {toast.type === "success"
                    ? "✅"
                    : toast.type === "error"
                    ? "⚠️"
                    : toast.type === "warning"
                    ? "🚨"
                    : "ℹ️"}
                </span>
                <span className="toast-message">{toast.message}</span>
                <button
                  type="button"
                  className="toast-close"
                  onClick={() => dismissToast(toast.id)}
                  aria-label="Đóng thông báo"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}

      {confirmState &&
        createPortal(
          <div
            className="custom-modal-backdrop"
            onClick={() => handleConfirmChoice(false)}
          >
            <div
              className="custom-modal-card"
              role="dialog"
              aria-modal="true"
              aria-label={confirmState.title}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="custom-modal-header">
                <h3>{confirmState.title}</h3>
                <button
                  type="button"
                  className="custom-modal-close"
                  onClick={() => handleConfirmChoice(false)}
                  aria-label="Đóng"
                >
                  ✕
                </button>
              </div>
              <p className="custom-modal-body">{confirmState.message}</p>
              <div className="custom-modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleConfirmChoice(false)}
                >
                  {confirmState.cancelText}
                </button>
                <button
                  type="button"
                  className={
                    confirmState.tone === "danger"
                      ? "btn-danger-solid"
                      : "btn-primary"
                  }
                  onClick={() => handleConfirmChoice(true)}
                >
                  {confirmState.confirmText}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error("useDialog must be used inside DialogProvider");
  }
  return ctx;
}

export function ZaloAppealBox({ compact = false }) {
  const { showToast } = useDialog();

  const handleCopyPhone = async () => {
    try {
      await navigator.clipboard.writeText(ZALO_ADMIN_PHONE);
      showToast("Đã sao chép số Zalo Admin: " + ZALO_ADMIN_PHONE, "success");
    } catch {
      showToast("Số Zalo Admin: " + ZALO_ADMIN_PHONE, "info");
    }
  };

  return (
    <div className={`zalo-appeal-box ${compact ? "compact" : ""}`}>
      <div className="zalo-appeal-title">
        <span>🛟 Hỗ trợ & Khiếu nại kết quả thi</span>
      </div>
      <p className="zalo-appeal-desc">
        Nếu bạn cho rằng hệ thống ghi nhận nhầm hoặc gặp sự cố kỹ thuật khách quan,
        vui lòng liên hệ trực tiếp Admin để được xem xét mở lại lượt thi:
      </p>
      <div className="zalo-appeal-actions">
        <span className="zalo-phone-pill">
          Zalo Admin: <strong>{ZALO_ADMIN_PHONE}</strong>
        </span>
        <a
          href={ZALO_ADMIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-zalo-chat"
        >
          💬 Nhắn Zalo Admin ngay
        </a>
        <button
          type="button"
          className="btn-zalo-copy"
          onClick={handleCopyPhone}
        >
          📋 Copy SĐT
        </button>
      </div>
    </div>
  );
}
