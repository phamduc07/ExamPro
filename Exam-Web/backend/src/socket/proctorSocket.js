import { Server } from "socket.io";
import { pool } from "../config/db.js";
import {
  AUTH_COOKIE_NAME,
  extractCookieValue,
  authenticateRawToken,
  isTrustedFrontendOrigin,
} from "../middlewares/authMiddleware.js";
import {
  getExamLiveProctoringData,
  getStudentLiveRow,
  updateStudentFocusState,
  recordViolationWithLog,
  reviewViolationLog,
} from "../services/proctorService.js";
import { isId } from "../utils/validation.js";

let ioInstance = null;

function isProctorRole(role) {
  return ["TEACHER", "ADMIN", "SUPER_ADMIN"].includes(role);
}

export function getProctorIo() {
  return ioInstance;
}

export async function emitProctorStudentState(examId, userId, preloadedRow = null) {
  if (!ioInstance || !isId(examId) || !isId(userId)) return;
  try {
    const row = preloadedRow || (await getStudentLiveRow(pool, Number(examId), Number(userId)));
    if (!row) return;
    const payload = {
      examId: Number(examId),
      student: row,
      timestamp: new Date().toISOString(),
    };
    ioInstance.to(`proctor:exam:${Number(examId)}`).to("proctor:global").emit("proctor:student_update", payload);
  } catch {
    return;
  }
}

export function emitProctorViolationNew(examId, violationLog, studentRow = null) {
  if (!ioInstance || !violationLog) return;
  const numericExamId = Number(examId);
  ioInstance
    .to(`proctor:exam:${numericExamId}`)
    .to("proctor:global")
    .emit("proctor:violation_new", {
      examId: numericExamId,
      violation: violationLog,
      student: studentRow || null,
      timestamp: new Date().toISOString(),
    });
}

export function emitViolationReviewed({
  examId,
  userId,
  violationLog,
  studentRow,
  validViolationCount,
  maxTabSwitches,
  forceSubmit,
  decision,
}) {
  if (!ioInstance) return;
  const numericExamId = Number(examId);
  const numericUserId = Number(userId);

  ioInstance
    .to(`proctor:exam:${numericExamId}`)
    .to("proctor:global")
    .emit("proctor:violation_reviewed", {
      examId: numericExamId,
      userId: numericUserId,
      violation: violationLog,
      student: studentRow || null,
      validViolationCount,
      maxTabSwitches,
      decision,
      timestamp: new Date().toISOString(),
    });

  if (studentRow) {
    ioInstance
      .to(`proctor:exam:${numericExamId}`)
      .to("proctor:global")
      .emit("proctor:student_update", {
        examId: numericExamId,
        student: studentRow,
        timestamp: new Date().toISOString(),
      });
  }

  ioInstance
    .to(`student:exam:${numericExamId}:user:${numericUserId}`)
    .to(`student:user:${numericUserId}`)
    .emit("student:violation_reviewed", {
      examId: numericExamId,
      violation: violationLog,
      validViolationCount,
      maxTabSwitches,
      forceSubmit: Boolean(forceSubmit),
      decision,
      message:
        decision === "DISMISSED"
          ? `Giám thị đã bỏ qua lỗi "${violationLog?.reason || ""}" cho bạn. Số lần vi phạm hiện tại: ${validViolationCount}/${maxTabSwitches}.`
          : `Giám thị đã xác nhận lỗi vi phạm "${violationLog?.reason || ""}". Số lần vi phạm hợp lệ: ${validViolationCount}/${maxTabSwitches}.`,
    });
}

export function emitStudentSuspended({ examId, userId, reason }) {
  if (!ioInstance) return;
  const numericExamId = Number(examId);
  const numericUserId = Number(userId);
  ioInstance
    .to(`student:exam:${numericExamId}:user:${numericUserId}`)
    .to(`student:user:${numericUserId}`)
    .emit("student:suspended", {
      examId: numericExamId,
      isSuspended: true,
      suspendReason: reason || "Vi phạm quy chế phòng thi",
    });
}

export function disconnectReplacedUserSockets(userId, keepSessionId = null) {
  if (!ioInstance || !userId) return;
  const roomName = `user:all:${Number(userId)}`;
  const socketsInRoom = ioInstance.sockets.adapter.rooms.get(roomName);
  if (!socketsInRoom) return;

  for (const socketId of socketsInRoom) {
    const s = ioInstance.sockets.sockets.get(socketId);
    if (!s) continue;
    if (!keepSessionId || s.user?.sessionId !== keepSessionId) {
      s.emit("auth:session_replaced", {
        code: "SESSION_REPLACED",
        message:
          "Tài khoản của bạn đã được đăng nhập ở thiết bị hoặc trình duyệt khác. Phiên hiện tại đã tự động đăng xuất.",
      });
      s.disconnect(true);
    }
  }
}

export function attachProctorSocketServer(httpServer, allowedOriginsSet) {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (!allowedOriginsSet || isTrustedFrontendOrigin(origin, allowedOriginsSet)) {
          return callback(null, true);
        }
        return callback(new Error("Origin không được phép bởi chính sách CORS Socket.IO."));
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
  });

  io.use(async (socket, next) => {
    try {
      const cookieToken = extractCookieValue(
        socket.handshake.headers?.cookie,
        AUTH_COOKIE_NAME
      );
      const authHeader = socket.handshake.headers?.authorization;
      const bearerToken =
        authHeader && authHeader.startsWith("Bearer ")
          ? authHeader.split(" ")[1]
          : null;
      const handshakeToken =
        typeof socket.handshake.auth?.token === "string"
          ? socket.handshake.auth.token
          : null;

      const rawToken = cookieToken || handshakeToken || bearerToken;
      const authResult = await authenticateRawToken(rawToken);
      if (!authResult.ok) {
        const err = new Error(authResult.message || "Unauthorized");
        err.data = { code: authResult.code };
        return next(err);
      }

      socket.user = authResult.user;
      return next();
    } catch (error) {
      return next(new Error("Không thể xác thực kết nối thời gian thực."));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.user;
    socket.join(`user:all:${user.id}`);

    if (isProctorRole(user.role)) {
      socket.join("proctor:global");

      socket.on("proctor:watch_exam", async (payload, ack) => {
        try {
          const examId = Number(payload?.examId);
          if (!isId(examId)) {
            if (typeof ack === "function") {
              ack({ success: false, message: "Mã đề thi không hợp lệ." });
            }
            return;
          }
          socket.join(`proctor:exam:${examId}`);
          const snapshot = await getExamLiveProctoringData(examId);
          if (typeof ack === "function") {
            ack({ success: true, data: snapshot });
          } else if (snapshot) {
            socket.emit("proctor:exam_snapshot", snapshot);
          }
        } catch (err) {
          if (typeof ack === "function") {
            ack({
              success: false,
              message: err.message || "Không thể tải dữ liệu giám sát trực tiếp.",
            });
          }
        }
      });

      socket.on("proctor:unwatch_exam", (payload) => {
        const examId = Number(payload?.examId);
        if (isId(examId)) {
          socket.leave(`proctor:exam:${examId}`);
        }
      });

      socket.on("proctor:review_violation", async (payload, ack) => {
        try {
          const examId = Number(payload?.examId);
          const violationId = Number(payload?.violationId);
          const decision = payload?.decision;
          const result = await reviewViolationLog({
            examId,
            violationId,
            decision,
            reviewer: user,
          });

          emitViolationReviewed({
            examId,
            userId: result.violationLog.user_id,
            violationLog: result.violationLog,
            studentRow: result.studentRow,
            validViolationCount: result.validViolationCount,
            maxTabSwitches: result.maxTabSwitches,
            forceSubmit: result.forceSubmit,
            decision: result.decision,
          });

          if (typeof ack === "function") {
            ack({ success: true, data: result });
          }
        } catch (err) {
          if (typeof ack === "function") {
            ack({
              success: false,
              message: err.message || "Không thể cập nhật trạng thái vi phạm.",
            });
          }
        }
      });

      return;
    }

    socket.join(`student:user:${user.id}`);

    socket.on("student:exam_enter", async (payload, ack) => {
      try {
        const examId = Number(payload?.examId);
        if (!isId(examId)) {
          if (typeof ack === "function") ack({ success: false });
          return;
        }
        socket.join(`student:exam:${examId}:user:${user.id}`);
        socket.data.activeExamId = examId;

        const row = await updateStudentFocusState({
          examId,
          userId: user.id,
          isFocused: payload?.isFocused !== false,
          unfocusedSeconds: payload?.unfocusedSeconds ?? 0,
        });
        if (row) {
          await emitProctorStudentState(examId, user.id, row);
        }
        if (typeof ack === "function") {
          ack({
            success: true,
            data: row
              ? {
                  tabSwitchCount: row.tab_switch_count,
                  unfocusedSeconds: row.unfocused_seconds,
                  isSuspended: Boolean(row.is_suspended),
                  suspendReason: row.suspend_reason,
                }
              : null,
          });
        }
      } catch {
        if (typeof ack === "function") ack({ success: false });
      }
    });

    socket.on("student:focus_change", async (payload) => {
      try {
        const examId = Number(payload?.examId || socket.data.activeExamId);
        if (!isId(examId)) return;
        const isFocused = Boolean(payload?.isFocused);
        const unfocusedSeconds = Number(payload?.unfocusedSeconds) || 0;
        const row = await updateStudentFocusState({
          examId,
          userId: user.id,
          isFocused,
          unfocusedSeconds,
        });
        if (row) {
          await emitProctorStudentState(examId, user.id, row);
        }
      } catch {
        return;
      }
    });

    socket.on("student:violation", async (payload, ack) => {
      try {
        const examId = Number(payload?.examId || socket.data.activeExamId);
        if (!isId(examId)) {
          if (typeof ack === "function") ack({ success: false });
          return;
        }
        const result = await recordViolationWithLog({
          examId,
          userId: user.id,
          reason: payload?.reason,
          unfocusedSeconds: payload?.unfocusedSeconds ?? payload?.unfocused_seconds ?? 0,
          answers: payload?.answers ?? null,
          clientEventId: payload?.clientEventId ?? null,
        });

        if (!result.notFound && !result.noActiveAttempt && result.violationLog) {
          emitProctorViolationNew(examId, result.violationLog, result.studentRow);
        } else if (result.studentRow) {
          await emitProctorStudentState(examId, user.id, result.studentRow);
        }

        if (typeof ack === "function") {
          if (result.notFound || result.noActiveAttempt) {
            ack({
              success: false,
              message:
                result.message ||
                (result.notFound
                  ? "Không tìm thấy đề thi."
                  : "Không có lượt làm bài hợp lệ đang diễn ra cho đề thi này."),
              data: null,
            });
          } else {
            ack({
              success: true,
              data: {
                antiCheatEnabled: result.antiCheatEnabled,
                isSuspended: result.isSuspended,
                suspendReason: result.suspendReason || null,
                tabSwitchCount: result.tabSwitchCount,
                maxTabSwitches: result.maxTabSwitches,
                forceSubmit: result.forceSubmit,
                submissionId: result.submissionId || null,
              },
            });
          }
        }
      } catch (err) {
        if (typeof ack === "function") {
          ack({ success: false, message: err.message });
        }
      }
    });

    socket.on("student:submitted", async (payload) => {
      try {
        const examId = Number(payload?.examId || socket.data.activeExamId);
        if (!isId(examId)) return;
        await emitProctorStudentState(examId, user.id);
      } catch {
        return;
      }
    });
  });

  ioInstance = io;
  return io;
}
