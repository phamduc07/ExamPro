import express from "express";
import rateLimit from "express-rate-limit";
import { verifyToken, requireRole, requireSuperAdmin } from "../middlewares/authMiddleware.js";
import {
  sendRegisterOtp,
  register,
  login,
  verifyAdminLoginOtp,
  resendAdminLoginOtp,
  checkAdminApprovalStatus,
  getMe,
  logout,
  changePassword,
  forceChangePassword,
  forgotPassword,
  resetPassword,
} from "../controllers/authController.js";
import {
  getStudentsForAdmin,
  unlockUser,
  getAdmins,
  createAdmin,
  revokeAdmin,
  deleteAdmin,
  approveAdminFirstLogin,
  rejectAdminFirstLogin,
} from "../controllers/userController.js";
import { chat } from "../controllers/chatController.js";
import {
  getSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  getQuestions,
  createQuestion,
  bulkCreateQuestions,
  updateQuestion,
  deleteQuestion,
} from "../controllers/questionController.js";
import {
  getExams,
  getExamById,
  getAdminExamOverview,
  getExamLeaderboard,
  getAdminLogs,
  createExam,
  updateExam,
  deleteExam,
  reopenExam,
} from "../controllers/examController.js";
import {
  submitExam,
  getMySubmissions,
  getSubmissionDetail,
  getAllSubmissions,
  deleteSubmission,
  suspendSubmission,
  unsuspendSubmission,
  recordExamViolation,
  getExamAttemptStatus,
} from "../controllers/submissionController.js";

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => {
    const emailPart = req.body?.email
      ? String(req.body.email).trim().toLowerCase()
      : req.body?.challengeToken
      ? String(req.body.challengeToken).slice(-16)
      : "";
    return `${req.ip || "unknown"}_${emailPart}`;
  },
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Bạn gửi quá nhiều yêu cầu xác thực. Vui lòng thử lại sau 15 phút.",
  },
});

const approvalPollLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 360,
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Quá nhiều yêu cầu kiểm tra trạng thái phê duyệt. Vui lòng thử lại sau.",
  },
});

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Bạn đã gửi quá nhiều câu hỏi cho Trợ lý AI. Vui lòng thử lại sau ít phút.",
  },
});

router.post("/auth/register/send-otp", authLimiter, sendRegisterOtp);
router.post("/auth/send-otp", authLimiter, sendRegisterOtp);
router.post("/auth/register", authLimiter, register);
router.post("/auth/login", authLimiter, login);
router.post("/auth/login/verify-otp", authLimiter, verifyAdminLoginOtp);
router.post("/auth/login/resend-otp", authLimiter, resendAdminLoginOtp);
router.post("/auth/login/check-approval", approvalPollLimiter, checkAdminApprovalStatus);
router.post("/auth/forgot-password", authLimiter, forgotPassword);
router.post("/auth/reset-password", authLimiter, resetPassword);
router.post("/auth/logout", verifyToken, logout);
router.post("/auth/change-password", verifyToken, changePassword);
router.post("/auth/force-change-password", authLimiter, forceChangePassword);
router.get("/auth/students", verifyToken, requireRole("TEACHER"), getStudentsForAdmin);
router.patch("/auth/unlock-user", verifyToken, requireRole("TEACHER"), unlockUser);
router.get("/auth/admins", verifyToken, requireSuperAdmin, getAdmins);
router.post("/auth/admins", verifyToken, requireSuperAdmin, createAdmin);
router.patch("/auth/admins/:id/revoke", verifyToken, requireSuperAdmin, revokeAdmin);
router.patch("/auth/admins/:id/approve-first-login", verifyToken, requireSuperAdmin, approveAdminFirstLogin);
router.patch("/auth/admins/:id/reject-first-login", verifyToken, requireSuperAdmin, rejectAdminFirstLogin);
router.delete("/users/:id", verifyToken, requireSuperAdmin, deleteAdmin);
router.get("/auth/me", verifyToken, getMe);

router.post("/chat", chatLimiter, verifyToken, chat);

router.get("/subjects", verifyToken, getSubjects);
router.post("/subjects", verifyToken, requireRole("TEACHER"), createSubject);
router.put("/subjects/:id", verifyToken, requireRole("TEACHER"), updateSubject);
router.delete("/subjects/:id", verifyToken, requireRole("TEACHER"), deleteSubject);

router.get("/questions", verifyToken, requireRole("TEACHER"), getQuestions);
router.post("/questions", verifyToken, requireRole("TEACHER"), createQuestion);
router.post("/questions/bulk", verifyToken, requireRole("TEACHER"), bulkCreateQuestions);
router.put("/questions/:id", verifyToken, requireRole("TEACHER"), updateQuestion);
router.delete("/questions/:id", verifyToken, requireRole("TEACHER"), deleteQuestion);

router.get("/exams", verifyToken, getExams);
router.get("/exams/admin-overview", verifyToken, requireRole("TEACHER"), getAdminExamOverview);
router.get("/exams/admin-logs", verifyToken, requireRole("TEACHER"), getAdminLogs);
router.get("/exams/:id/leaderboard", verifyToken, requireRole("TEACHER"), getExamLeaderboard);
router.get("/exams/:id/attempt-status", verifyToken, requireRole("STUDENT"), getExamAttemptStatus);
router.get("/exams/:id", verifyToken, getExamById);
router.post("/exams/:id/violation", verifyToken, requireRole("STUDENT"), recordExamViolation);
router.post("/exams", verifyToken, requireRole("TEACHER"), createExam);
router.put("/exams/:id", verifyToken, requireRole("TEACHER"), updateExam);
router.patch("/exams/:id/reopen", verifyToken, requireRole("TEACHER"), reopenExam);
router.delete("/exams/:id", verifyToken, requireRole("TEACHER"), deleteExam);

router.post("/submissions", verifyToken, requireRole("STUDENT"), submitExam);
router.post("/submissions/suspend", verifyToken, requireRole("TEACHER"), suspendSubmission);
router.post("/submissions/unsuspend", verifyToken, requireRole("TEACHER"), unsuspendSubmission);
router.get("/submissions/my-history", verifyToken, getMySubmissions);
router.get("/submissions/:id", verifyToken, getSubmissionDetail);
router.get("/submissions", verifyToken, requireRole("TEACHER"), getAllSubmissions);
router.delete("/submissions/:id", verifyToken, requireRole("TEACHER"), deleteSubmission);

export default router;
