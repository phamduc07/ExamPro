import { pool } from "../config/db.js";
import { isId, isNumber } from "../utils/validation.js";
import {
  parseAttemptBlueprint,
  formatQuestionsWithBlueprint,
  gradeAnswersWithBlueprint,
  analyzeSubmissionsAnomalies,
} from "../utils/examBlueprint.js";
import {
  getExamLiveProctoringData,
  recordViolationWithLog,
  reviewViolationLog,
} from "../services/proctorService.js";
import {
  emitProctorStudentState,
  emitProctorViolationNew,
  emitViolationReviewed,
  emitStudentSuspended,
} from "../socket/proctorSocket.js";

const NETWORK_GRACE_SECONDS = 15;

function sanitizeAnswersObject(rawAnswers, validQuestionIdSet = null) {
  let parsed = rawAnswers;
  if (typeof rawAnswers === "string") {
    try {
      parsed = JSON.parse(rawAnswers);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const clean = {};
  for (const [key, val] of Object.entries(parsed)) {
    if (!["A", "B", "C", "D"].includes(val)) continue;
    if (validQuestionIdSet && !validQuestionIdSet.has(String(key))) continue;
    clean[String(key)] = val;
  }
  return clean;
}

function gradeAnswersAgainstQuestions(questions, answersObj) {
  let correctCount = 0;
  const totalQuestions = questions.length;
  for (const q of questions) {
    const choice = answersObj[q.id] || answersObj[String(q.id)];
    if (choice && choice === q.correct_answer) {
      correctCount++;
    }
  }
  const score =
    totalQuestions > 0
      ? Number(((correctCount / totalQuestions) * 10).toFixed(2))
      : 0;
  return { correctCount, totalQuestions, score };
}

export async function isExamOfficiallyClosed(dbClient, exam) {
  const isPublished = Boolean(Number(exam.is_published));
  const nowMs = Date.now();
  const closeAtMs = exam.close_at ? new Date(exam.close_at).getTime() : NaN;
  const hasPassedCloseAt = Number.isFinite(closeAtMs) && closeAtMs <= nowMs;

  if (isPublished && !hasPassedCloseAt) {
    return false;
  }

  const sessionName = String(exam.exam_session || "").trim();
  if (sessionName && exam.subject_id) {
    const [openSiblings] = await dbClient.query(
      `SELECT id, close_at
       FROM exams
       WHERE subject_id = ?
         AND LOWER(TRIM(exam_session)) = LOWER(?)
         AND is_published = 1`,
      [Number(exam.subject_id), sessionName]
    );
    const anySiblingStillOpen = openSiblings.some((sib) => {
      if (!sib.close_at) return true;
      const sibCloseMs = new Date(sib.close_at).getTime();
      return !Number.isFinite(sibCloseMs) || sibCloseMs > nowMs;
    });
    if (anySiblingStillOpen) {
      return false;
    }
  }

  return true;
}

export async function syncExamProgress(req, res, next) {
  try {
    const examId = Number(req.params.id);
    if (!isId(examId)) {
      return res.status(400).json({
        success: false,
        message: "Mã đề thi không hợp lệ.",
      });
    }

    const rawAnswers = req.body?.answers ?? {};
    if (
      !rawAnswers ||
      typeof rawAnswers !== "object" ||
      Array.isArray(rawAnswers) ||
      !Object.values(rawAnswers).every((ans) => ["A", "B", "C", "D"].includes(ans))
    ) {
      return res.status(400).json({
        success: false,
        message: "Danh sách đáp án tạm lưu không hợp lệ.",
      });
    }

    const rawUnfocused =
      req.body?.unfocused_seconds ?? req.body?.unfocusedSeconds ?? 0;
    const safeUnfocused =
      isNumber(rawUnfocused) && Number(rawUnfocused) >= 0
        ? Math.floor(Number(rawUnfocused))
        : 0;

    const [exams] = await pool.query(
      "SELECT id, duration_minutes, close_at, anti_cheat, max_tab_switches FROM exams WHERE id = ? LIMIT 1",
      [examId]
    );
    if (!exams.length) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đề thi.",
      });
    }

    const [attemptRows] = await pool.query(
      `SELECT
         started_at,
         TIMESTAMPDIFF(SECOND, started_at, NOW()) AS elapsed_seconds,
         status,
         is_suspended,
         tab_switch_count,
         attempt_blueprint_json
       FROM exam_attempts
       WHERE exam_id = ? AND user_id = ?
       LIMIT 1`,
      [examId, req.user.id]
    );

    if (
      !attemptRows.length ||
      attemptRows[0].status !== "IN_PROGRESS" ||
      Number(attemptRows[0].is_suspended) === 1
    ) {
      return res.status(200).json({
        success: true,
        data: { synced: false },
      });
    }

    const blueprint = parseAttemptBlueprint(attemptRows[0].attempt_blueprint_json);
    let validIds;
    if (blueprint) {
      validIds = new Set(blueprint.items.map((it) => String(it.questionId)));
    } else {
      const [qRows] = await pool.query(
        "SELECT question_id FROM exam_questions WHERE exam_id = ?",
        [examId]
      );
      validIds = new Set(qRows.map((r) => String(r.question_id)));
    }
    const cleanAnswers = sanitizeAnswersObject(rawAnswers, validIds);

    const maxDurationSec = (Number(exams[0].duration_minutes) || 30) * 60;
    let effectiveAllowedSec = maxDurationSec;
    if (exams[0].close_at && attemptRows[0].started_at) {
      const closeLimitSec = Math.max(
        1,
        Math.floor(
          (new Date(exams[0].close_at).getTime() -
            new Date(attemptRows[0].started_at).getTime()) /
            1000
        )
      );
      effectiveAllowedSec = Math.min(maxDurationSec, closeLimitSec);
    }

    const elapsedSec = Math.max(0, Number(attemptRows[0].elapsed_seconds) || 0);
    if (elapsedSec > effectiveAllowedSec + NETWORK_GRACE_SECONDS) {
      return res.status(200).json({
        success: true,
        data: { synced: false, expired: true },
      });
    }

    const isAntiCheat = Boolean(Number(exams[0].anti_cheat));
    const maxAllowedTabs =
      Number.isInteger(Number(exams[0].max_tab_switches)) &&
      Number(exams[0].max_tab_switches) >= 1
        ? Number(exams[0].max_tab_switches)
        : 3;
    if (isAntiCheat && Number(attemptRows[0].tab_switch_count) > maxAllowedTabs) {
      return res.status(200).json({
        success: true,
        data: { synced: false, exceededViolations: true },
      });
    }

    const clampedUnfocused = Math.min(maxDurationSec, safeUnfocused);
    await pool.query(
      `UPDATE exam_attempts
       SET draft_answers_json = ?,
           unfocused_seconds = GREATEST(unfocused_seconds, ?)
       WHERE exam_id = ? AND user_id = ? AND status = 'IN_PROGRESS'`,
      [JSON.stringify(cleanAnswers), clampedUnfocused, examId, req.user.id]
    );

    return res.status(200).json({
      success: true,
      data: { synced: true },
    });
  } catch (error) {
    next(error);
  }
}

export async function submitExam(req, res, next) {
  let connection;
  try {
    const {
      examId,
      answers = {},
      timeSpentSeconds = 0,
      started_at,
      startedAt,
      tab_switch_count,
      tabSwitchCount,
      unfocused_seconds,
      unfocusedSeconds,
    } = req.body;
    if (!isId(examId)) {
      return res.status(400).json({
        success: false,
        message: "Thiếu mã đề thi (examId).",
      });
    }

    const rawTabSwitches = tab_switch_count ?? tabSwitchCount ?? 0;
    if (
      !isNumber(rawTabSwitches) ||
      !Number.isInteger(Number(rawTabSwitches)) ||
      Number(rawTabSwitches) < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Số lần rời tab không hợp lệ.",
      });
    }
    const safeTabSwitchCount = Number(rawTabSwitches);

    const rawUnfocusedSeconds = unfocused_seconds ?? unfocusedSeconds ?? 0;
    if (
      !isNumber(rawUnfocusedSeconds) ||
      !Number.isInteger(Number(rawUnfocusedSeconds)) ||
      Number(rawUnfocusedSeconds) < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Tổng thời gian mất focus không hợp lệ.",
      });
    }
    const safeUnfocusedSeconds = Number(rawUnfocusedSeconds);

    if (
      !answers ||
      typeof answers !== "object" ||
      Array.isArray(answers) ||
      !Object.values(answers).every((answer) => ["A", "B", "C", "D"].includes(answer))
    ) {
      return res.status(400).json({
        success: false,
        message: "Danh sách đáp án không hợp lệ.",
      });
    }

    const [exams] = await pool.query(
      "SELECT id, is_published, duration_minutes, major_group, open_at, close_at, max_attempts, anti_cheat, max_tab_switches FROM exams WHERE id = ?",
      [Number(examId)]
    );
    if (!exams.length) {
      return res.status(404).json({ success: false, message: "Không tìm thấy đề thi." });
    }
    const exam = exams[0];
    const isAntiCheatExam = Boolean(Number(exam.anti_cheat));
    const maxDurationSec = (Number(exam.duration_minutes) || 30) * 60;

    if (req.user.role === "STUDENT") {
      if (!exam.is_published) {
        return res.status(403).json({ success: false, message: "Đề thi này chưa được mở." });
      }
      const now = new Date();
      if (exam.open_at && now < new Date(exam.open_at)) {
        return res.status(403).json({ success: false, message: "Đề thi chưa đến thời gian mở." });
      }
      if (exam.major_group && exam.major_group !== "ALL") {
        let studentMajor = req.user.majorGroup;
        if (!studentMajor) {
          const [uRows] = await pool.query("SELECT major_group FROM users WHERE id = ?", [req.user.id]);
          studentMajor = uRows[0]?.major_group || null;
        }
        if (exam.major_group !== studentMajor) {
          return res.status(403).json({
            success: false,
            message: "Đề thi này không thuộc khối ngành của bạn.",
          });
        }
      }
    }

    if (
      !isNumber(timeSpentSeconds) ||
      !Number.isInteger(Number(timeSpentSeconds)) ||
      Number(timeSpentSeconds) < 0 ||
      Number(timeSpentSeconds) > maxDurationSec
    ) {
      return res.status(400).json({ success: false, message: "Thời gian làm bài không hợp lệ." });
    }

    let safeTimeSpent = Number(timeSpentSeconds) || 0;
    const rawStartedAt = started_at ?? startedAt;
    let resolvedStartedAt = null;

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [attemptRows] = await connection.query(
      `SELECT
         started_at,
         TIMESTAMPDIFF(SECOND, started_at, NOW()) AS elapsed_seconds,
         TIMESTAMPDIFF(SECOND, last_violation_at, NOW()) AS seconds_since_last_violation,
         status,
         is_suspended,
         suspend_reason,
         tab_switch_count,
         unfocused_seconds,
         draft_answers_json,
         attempt_blueprint_json
       FROM exam_attempts
       WHERE exam_id = ? AND user_id = ?
       FOR UPDATE`,
      [Number(examId), req.user.id]
    );

    if (attemptRows.length > 0 && Number(attemptRows[0].is_suspended) === 1) {
      await connection.rollback();
      const reason = attemptRows[0].suspend_reason || "Vi phạm quy chế phòng thi";
      return res.status(403).json({
        success: false,
        isSuspended: true,
        suspendReason: reason,
        message: `Bài thi của bạn đã bị Giám thị đình chỉ (0 điểm). Lý do: ${reason}`,
      });
    }

    if (!attemptRows.length || attemptRows[0].status !== "IN_PROGRESS") {
      await connection.rollback();
      if (
        !attemptRows.length &&
        req.user.role === "STUDENT" &&
        exam.close_at &&
        Date.now() > new Date(exam.close_at).getTime() + NETWORK_GRACE_SECONDS * 1000
      ) {
        return res.status(403).json({
          success: false,
          message: "Đề thi đã hết thời gian đóng.",
        });
      }
      return res.status(409).json({
        success: false,
        message: !attemptRows.length
          ? "Bạn chưa bắt đầu lượt làm bài hợp lệ cho đề thi này."
          : "Bài thi đã được nộp hoặc đã tự động chốt điểm, từ chối ghi đè thêm.",
      });
    }

    if (req.user.role === "STUDENT" && Number(exam.max_attempts) >= 1) {
      const [attemptCountRows] = await connection.query(
        "SELECT COUNT(*) AS cnt FROM submissions WHERE exam_id = ? AND student_id = ?",
        [Number(examId), req.user.id]
      );
      if (Number(attemptCountRows[0].cnt) >= Number(exam.max_attempts)) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: `Bạn đã hết lượt làm bài (${exam.max_attempts} lượt) cho đề thi này.`,
        });
      }
    }

    const activeAttempt = attemptRows[0];
    const activeBlueprint = parseAttemptBlueprint(activeAttempt.attempt_blueprint_json);

    let questions = [];
    let questionsById = new Map();
    if (activeBlueprint) {
      const bpIds = activeBlueprint.items.map((it) => it.questionId);
      const [bpQRows] = await connection.query(
        "SELECT id, correct_answer FROM questions WHERE id IN (?)",
        [bpIds]
      );
      questions = bpQRows;
      questionsById = new Map(bpQRows.map((q) => [Number(q.id), q]));
    } else {
      const [eqRows] = await connection.query(
        `SELECT q.id, q.correct_answer
         FROM exam_questions eq
         INNER JOIN questions q ON eq.question_id = q.id
         WHERE eq.exam_id = ?`,
        [Number(examId)]
      );
      questions = eqRows;
      questionsById = new Map(eqRows.map((q) => [Number(q.id), q]));
    }

    if (questions.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Đề thi chưa có câu hỏi nào để chấm điểm.",
      });
    }

    const questionIds = activeBlueprint
      ? new Set(activeBlueprint.items.map((it) => String(it.questionId)))
      : new Set(questions.map((q) => String(q.id)));

    if (Object.keys(answers).some((id) => !questionIds.has(id))) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Có đáp án cho câu hỏi không thuộc đề thi.",
      });
    }

    const serverStarted = activeAttempt.started_at ? new Date(activeAttempt.started_at) : null;
    const elapsedSeconds = Math.max(0, Number(activeAttempt.elapsed_seconds) || 0);

    let effectiveAllowedSec = maxDurationSec;
    if (exam.close_at && serverStarted && !Number.isNaN(serverStarted.getTime())) {
      const closeLimitSec = Math.max(
        1,
        Math.floor((new Date(exam.close_at).getTime() - serverStarted.getTime()) / 1000)
      );
      effectiveAllowedSec = Math.min(maxDurationSec, closeLimitSec);
    }

    const serializedBlueprint = activeBlueprint ? JSON.stringify(activeBlueprint) : null;

    if (
      req.user.role === "STUDENT" &&
      elapsedSeconds > effectiveAllowedSec + NETWORK_GRACE_SECONDS
    ) {
      const savedDraftAnswers = sanitizeAnswersObject(
        activeAttempt.draft_answers_json,
        questionIds
      );
      const {
        correctCount: draftCorrect,
        totalQuestions: draftTotal,
        score: draftScore,
      } = activeBlueprint
        ? gradeAnswersWithBlueprint(activeBlueprint, questionsById, savedDraftAnswers)
        : gradeAnswersAgainstQuestions(questions, savedDraftAnswers);

      const expiredTabCount = isAntiCheatExam
        ? Math.max(0, Number(activeAttempt.tab_switch_count) || 0)
        : 0;
      const expiredUnfocused = Math.min(
        maxDurationSec,
        Math.max(0, Number(activeAttempt.unfocused_seconds) || 0)
      );

      const [expiredInsert] = await connection.query(
        `INSERT INTO submissions
          (exam_id, student_id, score, correct_count, total_questions, time_spent_seconds, started_at, tab_switch_count, unfocused_seconds, answers_json, attempt_blueprint_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(examId),
          req.user.id,
          draftScore,
          draftCorrect,
          draftTotal,
          effectiveAllowedSec,
          serverStarted || new Date(),
          expiredTabCount,
          expiredUnfocused,
          JSON.stringify(savedDraftAnswers),
          serializedBlueprint,
        ]
      );
      await connection.query(
        "UPDATE exam_attempts SET status = 'COMPLETED', is_unfocused = 0 WHERE exam_id = ? AND user_id = ?",
        [Number(examId), req.user.id]
      );
      await connection.commit();
      emitProctorStudentState(examId, req.user.id);
      return res.status(400).json({
        success: false,
        isExpired: true,
        message:
          "Đã vượt quá thời gian làm bài cho phép (tối đa 15 giây trễ mạng). Hệ thống từ chối ghi đè thêm và đã tự động chốt điểm theo đáp án lưu gần nhất.",
        data: {
          submissionId: expiredInsert.insertId,
          score: draftScore,
          correctCount: draftCorrect,
          totalQuestions: draftTotal,
        },
      });
    }

    if (serverStarted && !Number.isNaN(serverStarted.getTime())) {
      resolvedStartedAt = serverStarted;
      safeTimeSpent = Math.min(maxDurationSec, Math.max(safeTimeSpent, elapsedSeconds));
    }
    if (!resolvedStartedAt && rawStartedAt) {
      const parsedDate = new Date(rawStartedAt);
      if (!Number.isNaN(parsedDate.getTime())) {
        resolvedStartedAt = parsedDate;
      }
    }
    if (!resolvedStartedAt) {
      resolvedStartedAt = new Date(Date.now() - safeTimeSpent * 1000);
    }

    const incomingCleanAnswers = sanitizeAnswersObject(answers, questionIds);
    const savedDraftAnswers = sanitizeAnswersObject(
      activeAttempt.draft_answers_json,
      questionIds
    );
    const maxAllowedTabs =
      Number.isInteger(Number(exam.max_tab_switches)) && Number(exam.max_tab_switches) >= 1
        ? Number(exam.max_tab_switches)
        : 3;
    const delayedAfterViolationLimit =
      isAntiCheatExam &&
      Number(activeAttempt.tab_switch_count) > maxAllowedTabs &&
      Number(activeAttempt.seconds_since_last_violation) > NETWORK_GRACE_SECONDS &&
      Object.keys(savedDraftAnswers).length > 0;

    const finalAnswersToGrade = delayedAfterViolationLimit
      ? savedDraftAnswers
      : Object.keys(incomingCleanAnswers).length > 0
      ? incomingCleanAnswers
      : savedDraftAnswers;

    const { correctCount, totalQuestions, score } = activeBlueprint
      ? gradeAnswersWithBlueprint(activeBlueprint, questionsById, finalAnswersToGrade)
      : gradeAnswersAgainstQuestions(questions, finalAnswersToGrade);

    const [vLogCheck] = await connection.query(
      `SELECT
         COUNT(*) AS total_logs,
         SUM(CASE WHEN status IN ('PENDING', 'CONFIRMED') THEN 1 ELSE 0 END) AS valid_logs
       FROM exam_violation_logs
       WHERE exam_id = ?
         AND user_id = ?
         AND (? IS NULL OR created_at >= DATE_SUB(?, INTERVAL 2 SECOND))`,
      [Number(examId), req.user.id, serverStarted, serverStarted]
    );
    const totalRecordedLogs = Number(vLogCheck[0]?.total_logs) || 0;
    const validRecordedLogs = Number(vLogCheck[0]?.valid_logs) || 0;

    const finalTabSwitchCount = !isAntiCheatExam
      ? 0
      : totalRecordedLogs > 0
      ? validRecordedLogs
      : Math.max(safeTabSwitchCount, Number(activeAttempt.tab_switch_count) || 0);
    const finalUnfocusedSeconds = Math.min(
      maxDurationSec,
      Math.max(safeUnfocusedSeconds, Number(activeAttempt.unfocused_seconds) || 0)
    );
    const serializedAnswers = JSON.stringify(finalAnswersToGrade);

    const [result] = await connection.query(
      `INSERT INTO submissions
        (exam_id, student_id, score, correct_count, total_questions, time_spent_seconds, started_at, tab_switch_count, unfocused_seconds, answers_json, attempt_blueprint_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(examId),
        req.user.id,
        score,
        correctCount,
        totalQuestions,
        safeTimeSpent,
        resolvedStartedAt,
        finalTabSwitchCount,
        finalUnfocusedSeconds,
        serializedAnswers,
        serializedBlueprint,
      ]
    );

    await connection.query(
      `UPDATE exam_attempts
       SET status = 'COMPLETED',
           is_unfocused = 0,
           tab_switch_count = ?,
           unfocused_seconds = ?,
           draft_answers_json = ?
       WHERE exam_id = ? AND user_id = ?`,
      [
        finalTabSwitchCount,
        finalUnfocusedSeconds,
        serializedAnswers,
        Number(examId),
        req.user.id,
      ]
    );

    await connection.commit();
    emitProctorStudentState(examId, req.user.id);

    return res.status(201).json({
      success: true,
      message: "Nộp bài thành công! Hệ thống đã chấm điểm tự động.",
      data: {
        submissionId: result.insertId,
        score,
        correctCount,
        totalQuestions,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    if (connection) connection.release();
  }
}

export async function getMySubmissions(req, res, next) {
  try {
    const [rows] = await pool.query(
      `
      SELECT
        sub.id,
        sub.exam_id,
        sub.student_id,
        sub.score,
        sub.correct_count,
        sub.total_questions,
        sub.time_spent_seconds,
        sub.started_at,
        sub.tab_switch_count,
        sub.unfocused_seconds,
        sub.is_suspended,
        sub.suspend_reason,
        sub.submitted_at,
        e.title AS exam_title,
        e.duration_minutes,
        e.pass_score,
        e.subject_id,
        e.is_published,
        e.close_at,
        e.exam_session,
        e.anti_cheat,
        s.name AS subject_name,
        s.code AS subject_code
      FROM submissions sub
      INNER JOIN exams e ON sub.exam_id = e.id
      INNER JOIN subjects s ON e.subject_id = s.id
      WHERE sub.student_id = ?
      ORDER BY sub.submitted_at DESC
      `,
      [req.user.id]
    );

    const formatted = await Promise.all(
      rows.map(async (row) => {
        const examClosed = await isExamOfficiallyClosed(pool, row);
        return {
          ...row,
          exam_closed: examClosed,
          can_view_answers: examClosed,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: formatted,
    });
  } catch (error) {
    next(error);
  }
}

export async function getSubmissionDetail(req, res, next) {
  try {
    const { id } = req.params;

    const [subRows] = await pool.query(
      `
      SELECT
        sub.*,
        e.title AS exam_title,
        e.subject_id,
        e.duration_minutes,
        e.pass_score,
        e.is_published,
        e.open_at,
        e.close_at,
        e.exam_session,
        e.max_attempts,
        e.shuffle_options,
        e.anti_cheat,
        s.name AS subject_name,
        s.code AS subject_code,
        u.full_name AS student_name,
        u.email AS student_email,
        u.student_code
      FROM submissions sub
      INNER JOIN exams e ON sub.exam_id = e.id
      INNER JOIN subjects s ON e.subject_id = s.id
      INNER JOIN users u ON sub.student_id = u.id
      WHERE sub.id = ?
      `,
      [id]
    );

    if (subRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy kết quả bài thi này.",
      });
    }

    const submission = subRows[0];

    if (req.user.role === "STUDENT" && submission.student_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền xem bài thi của sinh viên khác.",
      });
    }

    const isStudent = req.user.role === "STUDENT";
    const isAntiCheatExam = Boolean(Number(submission.anti_cheat));
    const examClosed = await isExamOfficiallyClosed(pool, submission);
    const canViewAnswers = !isStudent || examClosed;
    const isSuspended =
      Number(submission.is_suspended) === 1 || Boolean(submission.suspend_reason);
    const passed =
      !isSuspended && Number(submission.score) >= Number(submission.pass_score ?? 5);
    const { answers_json, attempt_blueprint_json, ...summarySubmission } = submission;

    if (isStudent && !canViewAnswers && isAntiCheatExam) {
      return res.status(200).json({
        success: true,
        data: {
          ...summarySubmission,
          anti_cheat: 1,
          passed,
          is_passed: passed,
          is_suspended: isSuspended ? 1 : 0,
          exam_closed: false,
          hideDetails: true,
          can_view_answers: false,
          options_pre_shuffled: false,
          questions: [],
        },
      });
    }

    const parsedAnswers = sanitizeAnswersObject(answers_json);
    const storedBlueprint = parseAttemptBlueprint(attempt_blueprint_json);
    let detailedQuestions = [];
    let optionsPreShuffled = false;

    if (storedBlueprint) {
      const bpQuestionIds = storedBlueprint.items.map((it) => it.questionId);
      const [bpQuestions] =
        bpQuestionIds.length > 0
          ? await pool.query(
              `SELECT id, subject_id, content, option_a, option_b, option_c, option_d, correct_answer, difficulty, explanation
               FROM questions
               WHERE id IN (?)`,
              [bpQuestionIds]
            )
          : [[]];
      const bpMap = new Map(bpQuestions.map((q) => [Number(q.id), q]));
      detailedQuestions = formatQuestionsWithBlueprint(storedBlueprint, bpMap, {
        includeAnswers: canViewAnswers,
        parsedAnswers,
      });
      optionsPreShuffled = true;
    } else {
      const [questions] = await pool.query(
        `
        SELECT
          q.id,
          q.content,
          q.option_a,
          q.option_b,
          q.option_c,
          q.option_d,
          q.correct_answer,
          q.difficulty,
          q.explanation,
          eq.order_index
        FROM exam_questions eq
        INNER JOIN questions q ON eq.question_id = q.id
        WHERE eq.exam_id = ?
        ORDER BY eq.order_index ASC, q.id ASC
        `,
        [submission.exam_id]
      );

      detailedQuestions = questions.map((q) => {
        const selectedOption = parsedAnswers[q.id] || parsedAnswers[String(q.id)] || null;
        if (!canViewAnswers) {
          return {
            id: q.id,
            content: q.content,
            option_a: q.option_a,
            option_b: q.option_b,
            option_c: q.option_c,
            option_d: q.option_d,
            difficulty: q.difficulty,
            order_index: q.order_index,
            selected_option: selectedOption,
          };
        }
        const isCorrect = selectedOption === q.correct_answer;
        return {
          id: q.id,
          content: q.content,
          option_a: q.option_a,
          option_b: q.option_b,
          option_c: q.option_c,
          option_d: q.option_d,
          correct_answer: q.correct_answer,
          difficulty: q.difficulty,
          explanation: q.explanation,
          order_index: q.order_index,
          selected_option: selectedOption,
          is_correct: isCorrect,
        };
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        ...summarySubmission,
        anti_cheat: isAntiCheatExam ? 1 : 0,
        passed,
        is_passed: passed,
        is_suspended: isSuspended ? 1 : 0,
        exam_closed: examClosed,
        hideDetails: false,
        can_view_answers: canViewAnswers,
        options_pre_shuffled: optionsPreShuffled,
        questions: detailedQuestions,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getAllSubmissions(req, res, next) {
  try {
    const { examId } = req.query;
    let sql = `
      SELECT
        sub.*,
        e.title AS exam_title,
        e.subject_id,
        e.duration_minutes,
        e.max_tab_switches,
        e.anti_cheat,
        e.pass_score,
        s.name AS subject_name,
        s.code AS subject_code,
        u.full_name AS student_name,
        u.email AS student_email,
        u.student_code
      FROM submissions sub
      INNER JOIN exams e ON sub.exam_id = e.id
      INNER JOIN subjects s ON e.subject_id = s.id
      INNER JOIN users u ON sub.student_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (examId) {
      sql += " AND sub.exam_id = ?";
      params.push(Number(examId));
    }

    sql += " ORDER BY sub.submitted_at DESC";

    const [rows] = await pool.query(sql, params);
    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        meta: {
          suspiciousPairs: [],
          anomalySummary: {
            totalAnomalousCount: 0,
            fastCount: 0,
            highViolationOrUnfocusCount: 0,
            collusionStudentCount: 0,
            suspiciousPairCount: 0,
          },
        },
      });
    }

    const examIds = Array.from(new Set(rows.map((r) => Number(r.exam_id))));
    const subjectIds = Array.from(new Set(rows.map((r) => Number(r.subject_id))));
    const examsById = new Map();
    for (const r of rows) {
      if (!examsById.has(Number(r.exam_id))) {
        examsById.set(Number(r.exam_id), {
          id: Number(r.exam_id),
          title: r.exam_title,
          duration_minutes: r.duration_minutes,
          max_tab_switches: r.max_tab_switches,
          anti_cheat: r.anti_cheat,
        });
      }
    }

    const [[qRows], [eqRows]] = await Promise.all([
      pool.query("SELECT id, correct_answer FROM questions WHERE subject_id IN (?)", [
        subjectIds,
      ]),
      pool.query(
        "SELECT exam_id, question_id FROM exam_questions WHERE exam_id IN (?)",
        [examIds]
      ),
    ]);

    const questionsById = new Map(qRows.map((q) => [Number(q.id), q]));
    const linkedMap = new Map();
    for (const eq of eqRows) {
      const exId = Number(eq.exam_id);
      if (!linkedMap.has(exId)) linkedMap.set(exId, []);
      linkedMap.get(exId).push(Number(eq.question_id));
    }

    const {
      enrichedSubmissions,
      suspiciousPairs,
      anomalySummary,
    } = analyzeSubmissionsAnomalies(rows, examsById, questionsById, linkedMap);

    const sanitizedRows = enrichedSubmissions.map(
      ({ attempt_blueprint_json, ...rest }) => rest
    );

    return res.status(200).json({
      success: true,
      data: sanitizedRows,
      meta: {
        suspiciousPairs,
        anomalySummary,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteSubmission(req, res, next) {
  let connection;
  try {
    const { id } = req.params;
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [infoRows] = await connection.query(
      `SELECT sub.id, sub.exam_id, sub.student_id, sub.score, e.title AS exam_title, s.code AS subject_code,
              u.full_name AS student_name, u.student_code
       FROM submissions sub
       LEFT JOIN exams e ON sub.exam_id = e.id
       LEFT JOIN subjects s ON e.subject_id = s.id
       LEFT JOIN users u ON sub.student_id = u.id
       WHERE sub.id = ?
       FOR UPDATE`,
      [id]
    );

    const [result] = await connection.query("DELETE FROM submissions WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy bản ghi kết quả cần xóa.",
      });
    }

    if (infoRows.length > 0) {
      const info = infoRows[0];
      await connection.query(
        `UPDATE exam_attempts
         SET is_suspended = 0,
             suspend_reason = NULL,
             tab_switch_count = 0,
             unfocused_seconds = 0,
             draft_answers_json = NULL,
             attempt_blueprint_json = NULL,
             last_violation_at = NULL,
             last_violation_reason = NULL
         WHERE exam_id = ? AND user_id = ?`,
        [info.exam_id, info.student_id]
      );

      await connection.query(
        `INSERT INTO admin_logs (admin_id, admin_name, action_type, exam_title, subject_code, details)
         VALUES (?, ?, 'DELETE_SUBMISSION', ?, ?, ?)`,
        [
          req.user?.id || null,
          req.user?.fullName || "Quản trị viên",
          info.exam_title || `Bài nộp #${id}`,
          info.subject_code || null,
          `Xóa bài nộp của SV ${info.student_name || "N/A"} (${info.student_code || "N/A"}) — điểm cũ: ${info.score}`,
        ]
      );
    }

    await connection.commit();
    return res.status(200).json({
      success: true,
      message: "Đã xóa kết quả thi thành công!",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    if (connection) connection.release();
  }
}

export async function suspendSubmission(req, res, next) {
  let connection;
  try {
    const { examId, userId, submissionId, reason } = req.body;
    if (!isId(examId) || !isId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Thiếu mã đề thi hoặc mã sinh viên cần đình chỉ.",
      });
    }
    const cleanReason =
      String(reason || "").trim().slice(0, 255) || "Vi phạm quy chế phòng thi";

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [examRows] = await connection.query(
      `SELECT e.id, e.title, e.duration_minutes, s.code AS subject_code,
              (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id) AS total_questions
       FROM exams e
       LEFT JOIN subjects s ON e.subject_id = s.id
       WHERE e.id = ?`,
      [Number(examId)]
    );
    if (!examRows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Không tìm thấy đề thi." });
    }
    const exam = examRows[0];

    const [userRows] = await connection.query(
      "SELECT id, full_name, student_code FROM users WHERE id = ?",
      [Number(userId)]
    );
    if (!userRows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Không tìm thấy sinh viên." });
    }
    const student = userRows[0];

    const [attemptRows] = await connection.query(
      "SELECT started_at, status, tab_switch_count, unfocused_seconds, draft_answers_json, attempt_blueprint_json FROM exam_attempts WHERE exam_id = ? AND user_id = ? FOR UPDATE",
      [Number(examId), Number(userId)]
    );
    const wasInProgress =
      attemptRows.length > 0 && attemptRows[0].status === "IN_PROGRESS";
    const attemptStartedAt = attemptRows[0]?.started_at
      ? new Date(attemptRows[0].started_at)
      : new Date();
    const attemptTabSwitches = Math.max(
      0,
      Number(attemptRows[0]?.tab_switch_count) || 0
    );
    const attemptUnfocused = Math.max(
      0,
      Number(attemptRows[0]?.unfocused_seconds) || 0
    );
    const attemptDraftAnswers = sanitizeAnswersObject(
      attemptRows[0]?.draft_answers_json
    );
    const attemptBlueprintObj = parseAttemptBlueprint(
      attemptRows[0]?.attempt_blueprint_json
    );

    await connection.query(
      `INSERT INTO exam_attempts (exam_id, user_id, started_at, status, is_suspended, suspend_reason, is_unfocused)
       VALUES (?, ?, ?, 'COMPLETED', 1, ?, 0)
       ON DUPLICATE KEY UPDATE
         status = 'COMPLETED',
         is_suspended = 1,
         is_unfocused = 0,
         suspend_reason = VALUES(suspend_reason)`,
      [Number(examId), Number(userId), attemptStartedAt, cleanReason]
    );

    const [existingSub] =
      wasInProgress && !isId(submissionId)
        ? [[]]
        : isId(submissionId)
        ? await connection.query(
            "SELECT id FROM submissions WHERE id = ? AND exam_id = ? AND student_id = ? LIMIT 1 FOR UPDATE",
            [Number(submissionId), Number(examId), Number(userId)]
          )
        : await connection.query(
            "SELECT id FROM submissions WHERE exam_id = ? AND student_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE",
            [Number(examId), Number(userId)]
          );

    if (existingSub.length > 0) {
      await connection.query(
        `UPDATE submissions
         SET score = 0, correct_count = 0, is_suspended = 1, suspend_reason = ?, submitted_at = ?
         WHERE id = ?`,
        [cleanReason, new Date(), existingSub[0].id]
      );
    } else {
      const maxDurationSec = (Number(exam.duration_minutes) || 30) * 60;
      const timeSpentSec = wasInProgress
        ? Math.min(
            maxDurationSec,
            Math.max(0, Math.round((Date.now() - attemptStartedAt.getTime()) / 1000))
          )
        : 0;
      await connection.query(
        `INSERT INTO submissions
          (exam_id, student_id, score, correct_count, total_questions, time_spent_seconds, started_at, tab_switch_count, unfocused_seconds, is_suspended, suspend_reason, answers_json, attempt_blueprint_json)
         VALUES (?, ?, 0, 0, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          Number(examId),
          Number(userId),
          attemptBlueprintObj
            ? attemptBlueprintObj.items.length
            : Number(exam.total_questions) || 0,
          timeSpentSec,
          attemptStartedAt,
          attemptTabSwitches,
          Math.min(maxDurationSec, attemptUnfocused),
          cleanReason,
          JSON.stringify(attemptDraftAnswers),
          attemptBlueprintObj ? JSON.stringify(attemptBlueprintObj) : null,
        ]
      );
    }

    await connection.query(
      `INSERT INTO admin_logs (admin_id, admin_name, action_type, exam_title, subject_code, details)
       VALUES (?, ?, 'SUSPEND_SUBMISSION', ?, ?, ?)`,
      [
        req.user?.id || null,
        req.user?.fullName || req.user?.email || "Admin",
        exam.title,
        exam.subject_code || null,
        `Đình chỉ bài thi (0đ) của SV ${student.full_name} (${student.student_code || student.id}) — Lý do: ${cleanReason}`,
      ]
    );

    await connection.commit();
    emitProctorStudentState(examId, userId);
    emitStudentSuspended({ examId, userId, reason: cleanReason });
    return res.status(200).json({
      success: true,
      message: `Đã đình chỉ bài thi (0 điểm) của sinh viên ${student.full_name}!`,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    if (connection) connection.release();
  }
}

export async function unsuspendSubmission(req, res, next) {
  let connection;
  try {
    const { examId, userId, submissionId } = req.body;
    if (!isId(examId) || !isId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Thiếu mã đề thi hoặc mã sinh viên cần mở lại lượt thi.",
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [examRows] = await connection.query(
      `SELECT e.id, e.title, s.code AS subject_code
       FROM exams e
       LEFT JOIN subjects s ON e.subject_id = s.id
       WHERE e.id = ?`,
      [Number(examId)]
    );
    const [userRows] = await connection.query(
      "SELECT id, full_name, student_code FROM users WHERE id = ?",
      [Number(userId)]
    );

    const [latestTargetRows] = isId(submissionId)
      ? await connection.query(
          `SELECT id
           FROM submissions
           WHERE id = ? AND exam_id = ? AND student_id = ?
           LIMIT 1
           FOR UPDATE`,
          [Number(submissionId), Number(examId), Number(userId)]
        )
      : await connection.query(
          `SELECT id
           FROM submissions
           WHERE exam_id = ? AND student_id = ?
           ORDER BY is_suspended DESC, (tab_switch_count > 0) DESC, id DESC
           LIMIT 1
           FOR UPDATE`,
          [Number(examId), Number(userId)]
        );

    if (latestTargetRows.length > 0) {
      await connection.query("DELETE FROM submissions WHERE id = ?", [
        latestTargetRows[0].id,
      ]);
    }

    await connection.query(
      "DELETE FROM exam_violation_logs WHERE exam_id = ? AND user_id = ?",
      [Number(examId), Number(userId)]
    );

    await connection.query(
      `UPDATE exam_attempts
       SET is_suspended = 0,
           suspend_reason = NULL,
           tab_switch_count = 0,
           unfocused_seconds = 0,
           is_unfocused = 0,
           draft_answers_json = NULL,
           attempt_blueprint_json = NULL,
           last_violation_at = NULL,
           last_violation_reason = NULL,
           status = 'COMPLETED'
       WHERE exam_id = ? AND user_id = ?`,
      [Number(examId), Number(userId)]
    );

    if (examRows.length && userRows.length) {
      await connection.query(
        `INSERT INTO admin_logs (admin_id, admin_name, action_type, exam_title, subject_code, details)
         VALUES (?, ?, 'UNSUSPEND_SUBMISSION', ?, ?, ?)`,
        [
          req.user?.id || null,
          req.user?.fullName || "Quản trị viên",
          examRows[0].title,
          examRows[0].subject_code || null,
          `Gỡ vi phạm & mở lại lượt thi cho SV ${userRows[0].full_name} (${userRows[0].student_code || userRows[0].id})`,
        ]
      );
    }

    await connection.commit();
    emitProctorStudentState(examId, userId);
    return res.status(200).json({
      success: true,
      message: "Đã mở lại lượt thi cho sinh viên thành công!",
    });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    if (connection) connection.release();
  }
}

export async function recordExamViolation(req, res, next) {
  try {
    const examId = Number(req.params.id);
    if (!isId(examId)) {
      return res.status(400).json({
        success: false,
        message: "Mã đề thi không hợp lệ.",
      });
    }

    const result = await recordViolationWithLog({
      examId,
      userId: req.user.id,
      reason: req.body?.reason,
      unfocusedSeconds:
        req.body?.unfocused_seconds ?? req.body?.unfocusedSeconds ?? 0,
      answers: req.body?.answers ?? null,
      clientEventId: req.body?.clientEventId ?? null,
    });

    if (result.notFound) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đề thi.",
      });
    }

    if (result.violationLog) {
      emitProctorViolationNew(examId, result.violationLog, result.studentRow);
    } else if (result.studentRow) {
      emitProctorStudentState(examId, req.user.id, result.studentRow);
    }

    return res.status(200).json({
      success: true,
      data: {
        antiCheatEnabled: result.antiCheatEnabled,
        isSuspended: result.isSuspended,
        suspendReason: result.suspendReason || undefined,
        tabSwitchCount: result.tabSwitchCount,
        maxTabSwitches: result.maxTabSwitches,
        forceSubmit: result.forceSubmit,
        submissionId: result.submissionId ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getLiveExamProctoring(req, res, next) {
  try {
    const examId = Number(req.params.id);
    if (!isId(examId)) {
      return res.status(400).json({
        success: false,
        message: "Mã đề thi không hợp lệ.",
      });
    }
    const data = await getExamLiveProctoringData(examId);
    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đề thi.",
      });
    }
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function reviewExamViolation(req, res, next) {
  try {
    const examId = Number(req.params.id);
    const violationId = Number(req.params.violationId);
    const decision = req.body?.decision;

    const result = await reviewViolationLog({
      examId,
      violationId,
      decision,
      reviewer: req.user,
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

    return res.status(200).json({
      success: true,
      message:
        result.decision === "DISMISSED"
          ? "Đã bỏ qua lỗi vi phạm và cập nhật lại số lỗi hợp lệ cho thí sinh."
          : "Đã xác nhận vi phạm và đồng bộ trạng thái cho thí sinh.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getExamAttemptStatus(req, res, next) {
  try {
    const examId = Number(req.params.id);
    if (!isId(examId)) {
      return res.status(400).json({
        success: false,
        message: "Mã đề thi không hợp lệ.",
      });
    }

    const [rows] = await pool.query(
      `SELECT ea.status, ea.is_suspended, ea.suspend_reason, ea.tab_switch_count, e.anti_cheat
       FROM exam_attempts ea
       INNER JOIN exams e ON ea.exam_id = e.id
       WHERE ea.exam_id = ? AND ea.user_id = ?
       LIMIT 1`,
      [examId, req.user.id]
    );

    if (!rows.length) {
      return res.status(200).json({
        success: true,
        data: {
          isSuspended: false,
          suspendReason: null,
          status: null,
          tabSwitchCount: 0,
        },
      });
    }

    const row = rows[0];
    const antiCheatOn = Boolean(Number(row.anti_cheat));
    const isTabAutoSuspend =
      !antiCheatOn &&
      String(row.suspend_reason || "").startsWith("Vượt quá giới hạn rời tab");
    return res.status(200).json({
      success: true,
      data: {
        isSuspended: isTabAutoSuspend ? false : Number(row.is_suspended) === 1,
        suspendReason: isTabAutoSuspend ? null : row.suspend_reason || null,
        status: row.status,
        tabSwitchCount: antiCheatOn ? Math.max(0, Number(row.tab_switch_count) || 0) : 0,
      },
    });
  } catch (error) {
    next(error);
  }
}
