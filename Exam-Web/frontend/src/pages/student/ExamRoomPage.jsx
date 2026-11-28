import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axiosClient from "../../api/axiosClient";
import { createRealtimeSocket } from "../../api/socketClient";
import { useExamStore } from "../../store/useExamStore";
import { useAuth } from "../../context/AuthContext";
import { useDialog, ZaloAppealBox } from "../../context/DialogContext";
import PreExamChecklistModal from "../../components/exam/PreExamChecklistModal";

const BLUR_GRACE_MS = 3000;

function formatClock(seconds) {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function seededShuffle(items, seedStr) {
  const arr = [...items];
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  }
  for (let i = arr.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function extractValidAnswers(raw) {
  const clean = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return clean;
  for (const [k, v] of Object.entries(raw)) {
    if (["A", "B", "C", "D"].includes(v)) {
      clean[String(k)] = v;
    }
  }
  return clean;
}

export default function ExamRoomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useDialog();

  const {
    activeExam,
    questions,
    currentIndex,
    answers,
    flaggedQuestions,
    remainingSeconds,
    startedAt,
    tabSwitchCount,
    startExamSession,
    selectAnswer,
    toggleFlagQuestion,
    goToQuestion,
    nextQuestion,
    prevQuestion,
    tickTimer,
    incrementTabSwitch,
    setTabSwitchCount,
    addUnfocusedMs,
    resetExamSession,
  } = useExamStore();

  const [checklistVerified, setChecklistVerified] = useState(() => {
    try {
      if (sessionStorage.getItem(`ptit_pre_exam_checked_${id}`) === "1") {
        return true;
      }
    } catch {}
    const saved = useExamStore.getState();
    return Number(saved.activeExam?.id) === Number(id) && saved.questions?.length > 0;
  });
  const [previewExam, setPreviewExam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [violationModal, setViolationModal] = useState(null);
  const [antiCheatWarning, setAntiCheatWarning] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));

  const submitLockRef = useRef(false);
  const lastTabSwitchRef = useRef(0);
  const autoSubmitTimerRef = useRef(null);
  const draftSyncTimerRef = useRef(null);
  const blurGraceTimerRef = useRef(null);
  const unfocusedSinceRef = useRef(null);
  const episodePenalizedRef = useRef(false);
  const ignoreBlurUntilRef = useRef(0);
  const latestAnswersRef = useRef({});
  const handleFinalSubmitRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    const clean = extractValidAnswers(answers);
    if (Object.keys(clean).length > 0) {
      latestAnswersRef.current = clean;
    }
  }, [answers]);

  const getSnapshotAnswers = useCallback(() => {
    const storeClean = extractValidAnswers(useExamStore.getState().answers);
    if (Object.keys(storeClean).length > 0) {
      return storeClean;
    }
    return extractValidAnswers(latestAnswersRef.current);
  }, []);

  const flushUnfocusSeconds = useCallback(() => {
    if (unfocusedSinceRef.current !== null) {
      const now = Date.now();
      const deltaMs = Math.max(0, now - unfocusedSinceRef.current);
      if (deltaMs > 0) {
        addUnfocusedMs(deltaMs);
      }
      unfocusedSinceRef.current =
        !document.hidden && document.hasFocus() ? null : now;
    }
    const totalMs = useExamStore.getState().unfocusedMs || 0;
    return totalMs <= 0 ? 0 : Math.max(1, Math.round(totalMs / 1000));
  }, [addUnfocusedMs]);

  const clearBlurGraceTimer = useCallback(() => {
    if (blurGraceTimerRef.current) {
      clearTimeout(blurGraceTimerRef.current);
      blurGraceTimerRef.current = null;
    }
  }, []);

  const lockRoomWithModal = useCallback(
    ({
      title = "🚫 Bài thi đã bị Giám thị đình chỉ (0 điểm)",
      reason = "Bài thi của bạn đã bị Giám thị đình chỉ (0 điểm).",
      nextPath = "/my-results",
      actionLabel = "Về trang Lịch sử làm bài",
    }) => {
      submitLockRef.current = true;
      setSubmitting(false);
      setShowConfirmModal(false);
      clearBlurGraceTimer();
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }
      if (draftSyncTimerRef.current) {
        clearTimeout(draftSyncTimerRef.current);
        draftSyncTimerRef.current = null;
      }
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setViolationModal({
        title,
        reason,
        nextPath,
        actionLabel,
      });
    },
    [clearBlurGraceTimer]
  );

  useEffect(() => {
    if (!user?.id || checklistVerified) return;
    let cancelled = false;
    setLoading(true);
    axiosClient
      .get(`/exams/${id}?mode=preview`)
      .then((res) => {
        if (cancelled) return;
        setPreviewExam(res.data.data);
      })
      .catch((err) => {
        if (cancelled) return;
        showToast(
          err.response?.data?.message || "Không thể tải thông tin đề thi.",
          "error"
        );
        navigate(err.response?.data?.isSuspended ? "/my-results" : "/");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, user?.id, checklistVerified, navigate, showToast]);

  useEffect(() => {
    if (!user?.id || !checklistVerified) return;
    let cancelled = false;
    submitLockRef.current = false;
    setSubmitting(false);
    setLoading(true);
    axiosClient
      .get(`/exams/${id}?mode=take`)
      .then((res) => {
        if (cancelled) return;
        const examPayload = res.data.data;
        if (!examPayload.questions?.length) {
          throw new Error("Đề thi chưa có câu hỏi.");
        }
        const prevActiveId = useExamStore.getState().activeExam?.id;
        if (Number(prevActiveId) !== Number(examPayload.id)) {
          latestAnswersRef.current = extractValidAnswers(examPayload.draft_answers);
        }
        startExamSession(examPayload, user.id);
        latestAnswersRef.current = extractValidAnswers(
          useExamStore.getState().answers
        );
        if (!Boolean(Number(examPayload.anti_cheat))) {
          setTabSwitchCount(0);
        } else if (typeof examPayload.current_tab_switch_count === "number") {
          setTabSwitchCount(examPayload.current_tab_switch_count);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        showToast(
          err.response?.data?.message || err.message || "Không thể vào phòng thi.",
          "error"
        );
        navigate(err.response?.data?.isSuspended ? "/my-results" : "/");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    id,
    user?.id,
    checklistVerified,
    navigate,
    startExamSession,
    setTabSwitchCount,
    showToast,
  ]);

  useEffect(() => {
    if (loading || !checklistVerified || !activeExam || submitLockRef.current) return;
    const currentAnswers = extractValidAnswers(answers);
    if (Object.keys(currentAnswers).length === 0) return;

    const pushProgress = () => {
      if (submitLockRef.current) return;
      const snapshot = getSnapshotAnswers();
      const unfocusedSec = flushUnfocusSeconds();
      axiosClient
        .put(`/exams/${id}/progress`, {
          answers: snapshot,
          unfocused_seconds: unfocusedSec,
        })
        .catch(() => {});
    };

    if (useExamStore.getState().remainingSeconds <= 15) {
      pushProgress();
      return;
    }

    if (draftSyncTimerRef.current) {
      clearTimeout(draftSyncTimerRef.current);
    }
    draftSyncTimerRef.current = setTimeout(() => {
      draftSyncTimerRef.current = null;
      pushProgress();
    }, 450);

    return () => {
      if (draftSyncTimerRef.current) {
        clearTimeout(draftSyncTimerRef.current);
        draftSyncTimerRef.current = null;
      }
    };
  }, [
    id,
    loading,
    checklistVerified,
    activeExam,
    answers,
    getSnapshotAnswers,
    flushUnfocusSeconds,
  ]);

  const handleFinalSubmit = useCallback(
    async (isAuto = false, autoReason = "timeout") => {
      if (submitLockRef.current) return;
      submitLockRef.current = true;
      setSubmitting(true);
      setShowConfirmModal(false);
      clearBlurGraceTimer();
      if (draftSyncTimerRef.current) {
        clearTimeout(draftSyncTimerRef.current);
        draftSyncTimerRef.current = null;
      }

      const totalUnfocusedSeconds = flushUnfocusSeconds();
      const finalAnswers = getSnapshotAnswers();
      const currentState = useExamStore.getState();
      const safeTotalSec = Math.max(0, Math.floor(Number(currentState.totalSeconds) || 0));
      const rawSpent =
        safeTotalSec - Math.ceil((currentState.deadline - Date.now()) / 1000);
      const timeSpent = Math.min(safeTotalSec, Math.max(0, Math.round(rawSpent)));

      try {
        const res = await axiosClient.post("/submissions", {
          examId: Number(id),
          answers: finalAnswers,
          timeSpentSeconds: timeSpent,
          started_at: currentState.startedAt,
          tab_switch_count: currentState.tabSwitchCount || 0,
          unfocused_seconds: totalUnfocusedSeconds,
        });
        const submissionId = res.data.data.submissionId;
        socketRef.current?.emit("student:submitted", { examId: Number(id) });
        const finalTabCount = currentState.tabSwitchCount || 0;
        const maxSwitches =
          Number(currentState.activeExam?.max_tab_switches) >= 1
            ? Number(currentState.activeExam.max_tab_switches)
            : 3;

        latestAnswersRef.current = {};
        resetExamSession();

        if (isAuto && autoReason === "tabLimit") {
          lockRoomWithModal({
            title: "🚫 Bài thi đã tự động thu do vượt quá số lần vi phạm",
            reason: `Bạn đã rời tab / mất focus quá 3s / thoát toàn màn hình vượt quá giới hạn cho phép (${finalTabCount}/${maxSwitches} lần). Hệ thống đã tự động thu bài và chấm điểm toàn bộ đáp án bạn đã chọn.`,
            nextPath: `/results/${submissionId}`,
            actionLabel: "Xem kết quả bài thi",
          });
          return;
        }

        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
        if (isAuto) {
          showToast(
            "⏰ Đã hết thời gian làm bài! Hệ thống đã tự động thu bài và chấm điểm của bạn.",
            "warning"
          );
        }
        navigate(`/results/${submissionId}`, { replace: true });
      } catch (err) {
        if (err.response?.data?.isSuspended) {
          latestAnswersRef.current = {};
          lockRoomWithModal({
            title: "🚫 Bài thi đã bị đình chỉ / thu bài do vi phạm quy chế",
            reason:
              err.response.data.suspendReason ||
              err.response.data.message ||
              "Bài thi của bạn đã bị Giám thị đình chỉ (0 điểm).",
            nextPath: "/my-results",
            actionLabel: "Về trang Lịch sử làm bài",
          });
          return;
        }
        if (err.response?.data?.isExpired || err.response?.status === 409) {
          const autoSubId = err.response?.data?.data?.submissionId;
          latestAnswersRef.current = {};
          resetExamSession();
          if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          }
          showToast(
            err.response?.data?.message || "Lượt làm bài đã kết thúc.",
            "warning"
          );
          navigate(autoSubId ? `/results/${autoSubId}` : "/my-results", {
            replace: true,
          });
          return;
        }

        submitLockRef.current = false;
        setSubmitting(false);
        const status = err.response?.status;
        if (isAuto && (!status || status >= 500 || status === 429)) {
          showToast(
            "Kết nối gián đoạn khi tự động nộp bài. Hệ thống sẽ thử gửi lại sau 3 giây...",
            "warning"
          );
          if (autoSubmitTimerRef.current) {
            clearTimeout(autoSubmitTimerRef.current);
          }
          autoSubmitTimerRef.current = setTimeout(() => {
            autoSubmitTimerRef.current = null;
            if (handleFinalSubmitRef.current) {
              handleFinalSubmitRef.current(true, autoReason);
            }
          }, 3000);
          return;
        }
        showToast(
          err.response?.data?.message || "Lỗi khi nộp bài. Vui lòng thử lại.",
          "error"
        );
      }
    },
    [
      id,
      navigate,
      resetExamSession,
      showToast,
      lockRoomWithModal,
      clearBlurGraceTimer,
      flushUnfocusSeconds,
      getSnapshotAnswers,
    ]
  );

  useEffect(() => {
    handleFinalSubmitRef.current = handleFinalSubmit;
  }, [handleFinalSubmit]);

  useEffect(() => {
    if (
      loading ||
      !checklistVerified ||
      !activeExam ||
      questions.length === 0 ||
      violationModal
    ) {
      return;
    }

    const interval = setInterval(() => {
      if (submitLockRef.current) return;
      tickTimer();
      const currentRem = useExamStore.getState().remainingSeconds;
      if (currentRem <= 0) {
        clearInterval(interval);
        handleFinalSubmit(true, "timeout");
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [
    loading,
    checklistVerified,
    activeExam,
    questions.length,
    violationModal,
    tickTimer,
    handleFinalSubmit,
  ]);

  useEffect(() => {
    if (loading || !checklistVerified || !activeExam || violationModal) return;
    let active = true;

    const checkStatus = async () => {
      if (submitLockRef.current) return;
      try {
        const res = await axiosClient.get(`/exams/${id}/attempt-status`);
        if (!active || submitLockRef.current) return;
        if (res.data?.data?.isSuspended) {
          latestAnswersRef.current = {};
          lockRoomWithModal({
            title: "🚫 Bài thi đã bị Giám thị đình chỉ (0 điểm)",
            reason:
              res.data.data.suspendReason ||
              "Bài thi của bạn đã bị Giám thị đình chỉ do vi phạm quy chế phòng thi.",
            nextPath: "/my-results",
            actionLabel: "Về trang Lịch sử làm bài",
          });
        }
      } catch {
        return;
      }
    };

    const pollTimer = setInterval(checkStatus, 4000);
    return () => {
      active = false;
      clearInterval(pollTimer);
    };
  }, [id, loading, checklistVerified, activeExam, violationModal, lockRoomWithModal]);

  useEffect(() => {
    if (loading || !checklistVerified || !activeExam || violationModal) return;
    const examNumericId = Number(id);
    const socket = createRealtimeSocket();
    socketRef.current = socket;

    const emitEnter = () => {
      if (submitLockRef.current) return;
      const focusedNow = !document.hidden && document.hasFocus();
      const unfocusedSec = flushUnfocusSeconds();
      socket.emit(
        "student:exam_enter",
        {
          examId: examNumericId,
          isFocused: focusedNow,
          unfocusedSeconds: unfocusedSec,
        },
        (ack) => {
          if (!ack?.success || !ack.data || submitLockRef.current) return;
          if (ack.data.isSuspended) {
            latestAnswersRef.current = {};
            lockRoomWithModal({
              title: "🚫 Bài thi đã bị Giám thị đình chỉ (0 điểm)",
              reason:
                ack.data.suspendReason ||
                "Bài thi của bạn đã bị Giám thị đình chỉ do vi phạm quy chế phòng thi.",
              nextPath: "/my-results",
              actionLabel: "Về trang Lịch sử làm bài",
            });
            return;
          }
          if (
            Boolean(Number(activeExam?.anti_cheat)) &&
            typeof ack.data.tabSwitchCount === "number"
          ) {
            setTabSwitchCount(ack.data.tabSwitchCount);
          }
        }
      );
    };

    socket.on("connect", emitEnter);
    if (socket.connected) {
      emitEnter();
    }

    socket.on("student:violation_reviewed", (payload) => {
      if (submitLockRef.current || Number(payload?.examId) !== examNumericId) {
        return;
      }
      if (typeof payload.validViolationCount === "number") {
        setTabSwitchCount(payload.validViolationCount);
      }
      if (payload.decision === "DISMISSED") {
        showToast(
          payload.message || "✅ Giám thị đã bỏ qua 1 lỗi vi phạm cho bạn.",
          "success"
        );
        setAntiCheatWarning(
          payload.validViolationCount === 0
            ? ""
            : `ℹ️ Giám thị vừa bỏ qua lỗi oan cho bạn. Số lần vi phạm hợp lệ: ${payload.validViolationCount}/${payload.maxTabSwitches}`
        );
      } else if (payload.decision === "CONFIRMED") {
        showToast(
          payload.message || "⚠️ Giám thị đã xác nhận lỗi vi phạm.",
          "warning"
        );
        if (payload.forceSubmit && handleFinalSubmitRef.current) {
          handleFinalSubmitRef.current(true, "tabLimit");
        }
      }
    });

    socket.on("student:suspended", (payload) => {
      if (submitLockRef.current || Number(payload?.examId) !== examNumericId) {
        return;
      }
      latestAnswersRef.current = {};
      lockRoomWithModal({
        title: "🚫 Bài thi đã bị Giám thị đình chỉ (0 điểm)",
        reason:
          payload.suspendReason ||
          "Bài thi của bạn đã bị Giám thị đình chỉ do vi phạm quy chế phòng thi.",
        nextPath: "/my-results",
        actionLabel: "Về trang Lịch sử làm bài",
      });
    });

    return () => {
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [
    id,
    loading,
    checklistVerified,
    activeExam,
    violationModal,
    flushUnfocusSeconds,
    setTabSwitchCount,
    showToast,
    lockRoomWithModal,
  ]);

  useEffect(() => {
    return () => {
      clearBlurGraceTimer();
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }
      if (draftSyncTimerRef.current) {
        clearTimeout(draftSyncTimerRef.current);
        draftSyncTimerRef.current = null;
      }
    };
  }, [clearBlurGraceTimer]);

  const applyServerViolationResponse = useCallback(
    (data) => {
      if (!data || submitLockRef.current) return;
      if (typeof data.tabSwitchCount === "number") {
        setTabSwitchCount(data.tabSwitchCount);
      }
      if (data.isSuspended) {
        latestAnswersRef.current = {};
        lockRoomWithModal({
          title: "🚫 Bài thi đã bị Giám thị đình chỉ (0 điểm)",
          reason:
            data.suspendReason ||
            "Bài thi của bạn đã bị Giám thị đình chỉ do vi phạm quy chế phòng thi.",
          nextPath: "/my-results",
          actionLabel: "Về trang Lịch sử làm bài",
        });
        return;
      }
      if (data.forceSubmit) {
        if (data.submissionId) {
          latestAnswersRef.current = {};
          resetExamSession();
          lockRoomWithModal({
            title: "🚫 Bài thi đã tự động thu do vượt quá số lần vi phạm",
            reason: `Bạn đã vượt quá giới hạn vi phạm cho phép (${data.tabSwitchCount}/${data.maxTabSwitches} lần). Hệ thống đã tự động thu bài của bạn.`,
            nextPath: `/results/${data.submissionId}`,
            actionLabel: "Xem kết quả bài thi",
          });
        } else if (handleFinalSubmitRef.current) {
          handleFinalSubmitRef.current(true, "tabLimit");
        }
      }
    },
    [setTabSwitchCount, lockRoomWithModal, resetExamSession]
  );

  const reportViolationToServer = useCallback(
    async (reason) => {
      if (submitLockRef.current || !Boolean(Number(activeExam?.anti_cheat))) return null;
      const baseUrl = String(
        axiosClient.defaults.baseURL || "http://localhost:5000/api"
      ).replace(/\/$/, "");
      const snapshotAnswers = getSnapshotAnswers();
      const unfocusedSec = flushUnfocusSeconds();
      const maxAllowedLocal =
        Number(activeExam?.max_tab_switches) >= 1
          ? Number(activeExam.max_tab_switches)
          : 3;
      const clientEventId =
        typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `vio_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      if (socketRef.current?.connected) {
        socketRef.current.emit(
          "student:violation",
          {
            examId: Number(id),
            reason,
            unfocusedSeconds: unfocusedSec,
            answers: snapshotAnswers,
            clientEventId,
          },
          (ack) => {
            if (ack?.success && ack.data) {
              applyServerViolationResponse(ack.data);
            }
          }
        );
      }

      try {
        const response = await fetch(`${baseUrl}/exams/${id}/violation`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          credentials: "include",
          keepalive: true,
          body: JSON.stringify({
            reason,
            answers: snapshotAnswers,
            unfocused_seconds: unfocusedSec,
            clientEventId,
          }),
        });
        const json = await response.json().catch(() => null);
        if (response.status === 401) {
          try {
            if (json?.message) {
              sessionStorage.setItem("ptit_auth_kick_notice", json.message);
            }
          } catch {}
          resetExamSession();
          if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          }
          window.location.replace("/login");
          return null;
        }
        if (json?.success && json.data) {
          applyServerViolationResponse(json.data);
          return json.data;
        }
      } catch {
        if (
          useExamStore.getState().tabSwitchCount > maxAllowedLocal &&
          handleFinalSubmitRef.current
        ) {
          handleFinalSubmitRef.current(true, "tabLimit");
        }
        return null;
      }

      if (
        useExamStore.getState().tabSwitchCount > maxAllowedLocal &&
        handleFinalSubmitRef.current
      ) {
        handleFinalSubmitRef.current(true, "tabLimit");
      }
      return null;
    },
    [
      id,
      activeExam?.anti_cheat,
      activeExam?.max_tab_switches,
      resetExamSession,
      applyServerViolationResponse,
      getSnapshotAnswers,
      flushUnfocusSeconds,
    ]
  );

  useEffect(() => {
    if (loading || !checklistVerified || !activeExam || violationModal) return;

    const isAntiCheatExam = Boolean(Number(activeExam.anti_cheat));
    const emitFocusTelemetry = (isFocused) => {
      if (submitLockRef.current) return;
      const unfocusedSec = flushUnfocusSeconds();
      socketRef.current?.emit("student:focus_change", {
        examId: Number(id),
        isFocused,
        unfocusedSeconds: unfocusedSec,
      });
    };

    if (document.hidden || !document.hasFocus()) {
      unfocusedSinceRef.current = Date.now();
      emitFocusTelemetry(false);
    }

    const triggerViolationNow = (reasonText) => {
      if (!isAntiCheatExam || submitLockRef.current) return;
      const now = Date.now();
      if (now - lastTabSwitchRef.current < 1200) return;
      lastTabSwitchRef.current = now;
      incrementTabSwitch();
      setAntiCheatWarning(`🚨 Cảnh báo Anti-Cheat: ${reasonText}`);
      reportViolationToServer(reasonText);
    };

    const handleVisibilityChange = () => {
      if (submitLockRef.current) return;
      if (document.hidden) {
        if (unfocusedSinceRef.current === null) {
          unfocusedSinceRef.current = Date.now();
        }
        clearBlurGraceTimer();
        episodePenalizedRef.current = true;
        emitFocusTelemetry(false);
        triggerViolationNow("Rời tab hoặc thu nhỏ trình duyệt");
      } else if (document.hasFocus()) {
        episodePenalizedRef.current = false;
        emitFocusTelemetry(true);
      }
    };

    const handleWindowBlur = () => {
      if (submitLockRef.current) return;
      if (Date.now() < ignoreBlurUntilRef.current) return;
      if (unfocusedSinceRef.current === null) {
        unfocusedSinceRef.current = Date.now();
      }
      emitFocusTelemetry(false);
      if (!isAntiCheatExam || document.hidden || episodePenalizedRef.current) {
        return;
      }
      clearBlurGraceTimer();
      setAntiCheatWarning(
        "⏳ Cửa sổ bài thi vừa mất focus! Quay lại trong vòng 3 giây để không bị tính lỗi vi phạm."
      );
      blurGraceTimerRef.current = setTimeout(() => {
        blurGraceTimerRef.current = null;
        if (submitLockRef.current || episodePenalizedRef.current) return;
        if (document.hidden || !document.hasFocus()) {
          episodePenalizedRef.current = true;
          emitFocusTelemetry(false);
          triggerViolationNow("Mất focus cửa sổ quá 3 giây (Chuyển sang cửa sổ khác)");
        }
      }, BLUR_GRACE_MS);
    };

    const handleWindowFocus = () => {
      const returnedWithinGrace = blurGraceTimerRef.current !== null;
      clearBlurGraceTimer();
      episodePenalizedRef.current = false;
      emitFocusTelemetry(true);
      if (returnedWithinGrace && isAntiCheatExam && !submitLockRef.current) {
        setAntiCheatWarning("");
      }
    };

    const unfocusPulseInterval = setInterval(() => {
      if (submitLockRef.current) return;
      if (unfocusedSinceRef.current !== null || document.hidden || !document.hasFocus()) {
        emitFocusTelemetry(false);
      }
    }, 2000);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      clearInterval(unfocusPulseInterval);
      clearBlurGraceTimer();
      flushUnfocusSeconds();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [
    id,
    loading,
    checklistVerified,
    activeExam,
    violationModal,
    incrementTabSwitch,
    reportViolationToServer,
    clearBlurGraceTimer,
    flushUnfocusSeconds,
  ]);

  const requestExamFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      const el = document.documentElement;
      const reqFs =
        el.requestFullscreen ||
        el.webkitRequestFullscreen ||
        el.msRequestFullscreen;
      if (reqFs) {
        ignoreBlurUntilRef.current = Date.now() + 1000;
        Promise.resolve(reqFs.call(el)).catch(() => {});
      }
    }
  }, []);

  useEffect(() => {
    if (
      loading ||
      !checklistVerified ||
      !activeExam ||
      !Boolean(Number(activeExam.anti_cheat))
    ) {
      return;
    }

    setIsFullscreen(Boolean(document.fullscreenElement));
    ignoreBlurUntilRef.current = Math.max(
      ignoreBlurUntilRef.current,
      Date.now() + 1500
    );

    const triggerFullscreenViolation = (reasonText) => {
      if (submitLockRef.current) return;
      const now = Date.now();
      if (now - lastTabSwitchRef.current < 1200) return;
      lastTabSwitchRef.current = now;
      incrementTabSwitch();
      setAntiCheatWarning(`🚨 Cảnh báo Anti-Cheat: ${reasonText}`);
      reportViolationToServer(reasonText);
    };

    const blockEvent = (e) => {
      e.preventDefault();
      setAntiCheatWarning(
        "🛡️ Chế độ Anti-Cheat: Không được phép sao chép hoặc mở menu chuột phải."
      );
    };

    const handleKeyDown = (e) => {
      const key = e.key?.toLowerCase();
      const isDevToolsShortcut =
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && ["i", "j", "c"].includes(key)) ||
        (e.ctrlKey && key === "u");
      if (isDevToolsShortcut) {
        e.preventDefault();
        setAntiCheatWarning(
          "🛡️ Chế độ Anti-Cheat: Không được phép mở công cụ lập trình (DevTools / Xem nguồn)."
        );
      }
    };

    const handleFullscreenChange = () => {
      const inFs = Boolean(document.fullscreenElement);
      setIsFullscreen(inFs);
      if (!inFs && !submitLockRef.current) {
        triggerFullscreenViolation("Bạn vừa thoát khỏi chế độ Toàn màn hình.");
      }
    };

    document.addEventListener("contextmenu", blockEvent);
    document.addEventListener("copy", blockEvent);
    document.addEventListener("cut", blockEvent);
    document.addEventListener("selectstart", blockEvent);
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("contextmenu", blockEvent);
      document.removeEventListener("copy", blockEvent);
      document.removeEventListener("cut", blockEvent);
      document.removeEventListener("selectstart", blockEvent);
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [loading, checklistVerified, activeExam, incrementTabSwitch, reportViolationToServer]);

  if (!checklistVerified) {
    if (loading) {
      return (
        <div className="loading-screen">
          <div className="spinner"></div>
          <p>Đang tải thông tin phòng thi...</p>
        </div>
      );
    }
    return (
      <div className="loading-screen">
        <PreExamChecklistModal
          open={true}
          exam={previewExam}
          onClose={() => navigate(`/exams/${id}`)}
          onConfirmStart={() => {
            try {
              sessionStorage.setItem(`ptit_pre_exam_checked_${id}`, "1");
            } catch {}
            requestExamFullscreen();
            setChecklistVerified(true);
          }}
        />
      </div>
    );
  }

  if (loading || !activeExam) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Đang chuẩn bị phòng thi trực tuyến...</p>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex] || {};
  const totalQ = questions.length;
  const answeredCount = Object.keys(answers).length;
  const progressPercent = totalQ > 0 ? Math.round((answeredCount / totalQ) * 100) : 0;
  const isFlagged = flaggedQuestions.includes(currentQuestion.id);
  const isTimeUrgent = remainingSeconds <= 180;
  const isAntiCheat = Boolean(Number(activeExam.anti_cheat));
  const maxTabSwitches = isAntiCheat
    ? Number(activeExam.max_tab_switches) >= 1
      ? Number(activeExam.max_tab_switches)
      : 3
    : null;
  const hasTabLimit = isAntiCheat;

  const baseOptions = [
    { key: "A", text: currentQuestion.option_a },
    { key: "B", text: currentQuestion.option_b },
    { key: "C", text: currentQuestion.option_c },
    { key: "D", text: currentQuestion.option_d },
  ];
  const displayLabels = ["A", "B", "C", "D"];
  const options =
    !activeExam.options_pre_shuffled && activeExam.shuffle_options
      ? seededShuffle(
          baseOptions,
          `${activeExam.id}-${currentQuestion.id}-${startedAt || ""}`
        )
      : baseOptions;

  return (
    <div
      className="exam-room-shell"
      style={isAntiCheat ? { userSelect: "none", WebkitUserSelect: "none" } : undefined}
    >
      <header className="exam-room-header">
        <div className="exam-room-brand">
          <span className="exam-subject-tag">{activeExam.subject_code}</span>
          <div>
            <h1 className="exam-room-title">{activeExam.title}</h1>
            <span className="exam-room-sub">
              Đã trả lời: <strong>{answeredCount}/{totalQ}</strong> câu ({progressPercent}%)
            </span>
          </div>
        </div>

        <div className="exam-progress-bar-wrap">
          <div className="exam-progress-track">
            <div
              className="exam-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div className="exam-room-controls">
          {isAntiCheat && (
            <>
              <span className="tab-switch-badge danger">
                🛡️ Giám sát Anti-Cheat
              </span>
              {!isFullscreen && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                  onClick={requestExamFullscreen}
                >
                  ⛶ Toàn màn hình
                </button>
              )}

              <div
                className={`tab-switch-badge ${
                  tabSwitchCount === 0
                    ? "safe"
                    : hasTabLimit && tabSwitchCount >= maxTabSwitches
                    ? "danger"
                    : tabSwitchCount <= 2
                    ? "warn"
                    : "danger"
                }`}
                title="Số lần bạn rời khỏi tab hoặc cửa sổ phòng thi"
              >
                👁️ Vi phạm: <strong>{tabSwitchCount}</strong>/{maxTabSwitches}
              </div>
            </>
          )}

          <div className={`countdown-badge ${isTimeUrgent ? "urgent" : ""}`}>
            <span className="clock-icon">⏱️</span>
            <span className="clock-time">{formatClock(remainingSeconds)}</span>
          </div>

          <button
            type="button"
            className="btn-submit-exam"
            disabled={submitting}
            onClick={() => setShowConfirmModal(true)}
          >
            {submitting ? "Đang nộp..." : "📤 Nộp bài thi"}
          </button>
        </div>
      </header>

      {isAntiCheat && antiCheatWarning && (
        <div className="container" style={{ marginTop: "12px" }}>
          <div className="alert-box alert-error" role="alert">
            {antiCheatWarning}
          </div>
        </div>
      )}

      <div className="exam-room-body container">
        <section className="question-stage-card">
          <div className="question-stage-top">
            <div className="q-index-badge">
              <span>Câu hỏi số {currentIndex + 1}</span>
              <small> / {totalQ}</small>
              <span className={`diff-tag ${currentQuestion.difficulty?.toLowerCase()}`}>
                {currentQuestion.difficulty === "EASY"
                  ? "Mức Dễ"
                  : currentQuestion.difficulty === "HARD"
                  ? "Mức Khó"
                  : "Trung bình"}
              </span>
            </div>

            <button
              type="button"
              className={`btn-flag ${isFlagged ? "flagged" : ""}`}
              onClick={() => toggleFlagQuestion(currentQuestion.id)}
            >
              🚩 {isFlagged ? "Đã gắn cờ xem lại" : "Đánh dấu câu hỏi"}
            </button>
          </div>

          <div className="question-prompt">
            <p>{currentQuestion.content}</p>
          </div>

          <div className="options-grid">
            {options.map((opt, idx) => {
              const selected = answers[currentQuestion.id] === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  className={`option-choice-card ${selected ? "selected" : ""}`}
                  disabled={submitting || remainingSeconds <= 0}
                  onClick={() => selectAnswer(currentQuestion.id, opt.key)}
                >
                  <span className="option-letter">{displayLabels[idx] || opt.key}</span>
                  <span className="option-content">{opt.text}</span>
                  <span className="option-radio-dot">
                    {selected ? "✓" : ""}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="question-stage-footer">
            <button
              type="button"
              className="btn-nav-q secondary"
              disabled={currentIndex === 0}
              onClick={prevQuestion}
            >
              ← Câu trước
            </button>

            <span className="stage-pos-hint">
              Sử dụng bảng câu hỏi bên phải để chuyển nhanh tới câu bất kỳ
            </span>

            <button
              type="button"
              className="btn-nav-q primary"
              disabled={currentIndex === totalQ - 1}
              onClick={nextQuestion}
            >
              Câu tiếp theo →
            </button>
          </div>
        </section>

        <aside className="question-palette-card">
          <h3>Danh sách câu hỏi</h3>

          <div className="palette-legend-grid">
            <div className="legend-item">
              <span className="dot answered" /> Đã trả lời ({answeredCount})
            </div>
            <div className="legend-item">
              <span className="dot unanswered" /> Chưa làm ({totalQ - answeredCount})
            </div>
            <div className="legend-item">
              <span className="dot current" /> Đang chọn
            </div>
            <div className="legend-item">
              <span className="dot flagged" /> Cắm cờ ({flaggedQuestions.length})
            </div>
          </div>

          <div className="palette-numbers-grid">
            {questions.map((q, idx) => {
              const isAns = Boolean(answers[q.id]);
              const isCur = idx === currentIndex;
              const isFlg = flaggedQuestions.includes(q.id);

              return (
                <button
                  key={q.id}
                  type="button"
                  className={`palette-num-btn ${isCur ? "current" : ""} ${
                    isAns ? "answered" : ""
                  } ${isFlg ? "flagged" : ""}`}
                  onClick={() => goToQuestion(idx)}
                >
                  {idx + 1}
                  {isFlg && <i className="mini-flag">🚩</i>}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="btn-submit-exam btn-full"
            disabled={submitting}
            onClick={() => setShowConfirmModal(true)}
          >
            📤 Hoàn thành & Nộp bài
          </button>
        </aside>
      </div>

      {showConfirmModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-icon">📋</div>
            <h2>Xác nhận nộp bài thi?</h2>
            <p>
              Bạn đã trả lời <strong>{answeredCount}</strong> trên tổng số{" "}
              <strong>{totalQ}</strong> câu hỏi.
            </p>
            {totalQ - answeredCount > 0 && (
              <div className="alert-box alert-warning">
                ⚠️ Bạn vẫn còn <strong>{totalQ - answeredCount} câu hỏi</strong> chưa
                chọn đáp án!
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowConfirmModal(false)}
              >
                Quay lại làm tiếp
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={submitting}
                onClick={() => handleFinalSubmit(false)}
              >
                {submitting ? "Đang chấm điểm..." : "Đồng ý nộp bài"}
              </button>
            </div>
          </div>
        </div>
      )}

      {violationModal && (
        <div className="custom-modal-backdrop">
          <div
            className="custom-modal-card danger-modal"
            role="dialog"
            aria-modal="true"
            aria-label={violationModal.title}
          >
            <div className="custom-modal-header">
              <h3>{violationModal.title}</h3>
            </div>

            <div className="violation-reason-box">
              <strong>Lý do ghi nhận:</strong> {violationModal.reason}
            </div>

            <ZaloAppealBox />

            <div className="custom-modal-footer">
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  const target = violationModal.nextPath || "/my-results";
                  setViolationModal(null);
                  resetExamSession();
                  if (document.fullscreenElement && document.exitFullscreen) {
                    document.exitFullscreen().catch(() => {});
                  }
                  navigate(target, { replace: true });
                }}
              >
                {violationModal.actionLabel || "Tiếp tục"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
