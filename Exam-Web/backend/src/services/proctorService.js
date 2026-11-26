import { pool } from "../config/db.js";
import { parseAttemptBlueprint } from "../utils/examBlueprint.js";
import { isId, isNumber } from "../utils/validation.js";

const NETWORK_GRACE_SECONDS = 15;
const VALID_CHOICES = new Set(["A", "B", "C", "D"]);

function sanitizeAnswersMap(rawAnswers, validQuestionIdSet = null) {
  let source = rawAnswers;
  if (!source) return {};
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return {};
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {};
  }
  const clean = {};
  for (const [qId, choice] of Object.entries(source)) {
    const key = String(qId);
    if (validQuestionIdSet && !validQuestionIdSet.has(key)) continue;
    if (VALID_CHOICES.has(choice)) {
      clean[key] = choice;
    }
  }
  return clean;
}

export async function getStudentLiveRow(dbClient, examId, userId) {
  const [rows] = await dbClient.query(
    `SELECT
       u.id AS user_id,
       u.full_name,
       u.student_code,
       u.major_group,
       u.email,
       ea.id AS attempt_id,
       ea.started_at,
       ea.status AS attempt_status,
       ea.is_suspended AS attempt_suspended,
       ea.suspend_reason AS attempt_suspend_reason,
       ea.tab_switch_count AS attempt_tab_switches,
       ea.unfocused_seconds AS attempt_unfocused_seconds,
       ea.is_unfocused,
       ea.last_violation_at,
       ea.last_violation_reason,
       sub.id AS submission_id,
       sub.score,
       sub.correct_count,
       sub.total_questions,
       sub.time_spent_seconds,
       sub.submitted_at,
       sub.tab_switch_count AS sub_tab_switches,
       sub.unfocused_seconds AS sub_unfocused_seconds,
       sub.is_suspended AS sub_suspended,
       sub.suspend_reason AS sub_suspend_reason
     FROM users u
     LEFT JOIN exam_attempts ea
       ON ea.user_id = u.id AND ea.exam_id = ?
     LEFT JOIN submissions sub
       ON sub.id = (
         SELECT s2.id
         FROM submissions s2
         WHERE s2.exam_id = ? AND s2.student_id = u.id
         ORDER BY s2.id DESC
         LIMIT 1
       )
     WHERE u.id = ?
     LIMIT 1`,
    [Number(examId), Number(examId), Number(userId)]
  );

  if (!rows.length || (!rows[0].attempt_id && !rows[0].submission_id)) {
    return null;
  }

  const r = rows[0];
  const baselineStartedAt = r.started_at || r.submitted_at || null;
  const [vCounts] = await dbClient.query(
    `SELECT
       SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending_cnt,
       SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed_cnt,
       SUM(CASE WHEN status = 'DISMISSED' THEN 1 ELSE 0 END) AS dismissed_cnt
     FROM exam_violation_logs
     WHERE exam_id = ?
       AND user_id = ?
       AND (? IS NULL OR created_at >= DATE_SUB(?, INTERVAL 2 SECOND))`,
    [Number(examId), Number(userId), baselineStartedAt, baselineStartedAt]
  );

  const isSuspended =
    Number(r.attempt_suspended) === 1 ||
    (r.attempt_status !== "IN_PROGRESS" && Number(r.sub_suspended) === 1);

  const isInProgress = Boolean(r.attempt_id) && r.attempt_status === "IN_PROGRESS" && !isSuspended;

  let liveStatus = "WORKING";
  if (isSuspended) {
    liveStatus = "SUSPENDED";
  } else if (!isInProgress && (r.attempt_status === "COMPLETED" || r.submission_id)) {
    liveStatus = "SUBMITTED";
  } else if (Number(r.is_unfocused) === 1) {
    liveStatus = "UNFOCUSED";
  }

  const tabSwitchCount = isInProgress
    ? Math.max(0, Number(r.attempt_tab_switches) || 0)
    : Math.max(0, Number(r.sub_tab_switches ?? r.attempt_tab_switches) || 0);

  const unfocusedSeconds = isInProgress
    ? Math.max(0, Number(r.attempt_unfocused_seconds) || 0)
    : Math.max(0, Number(r.sub_unfocused_seconds ?? r.attempt_unfocused_seconds) || 0);

  return {
    exam_id: Number(examId),
    user_id: Number(r.user_id),
    full_name: r.full_name,
    student_code: r.student_code || null,
    major_group: r.major_group || null,
    live_status: liveStatus,
    started_at: r.started_at || null,
    submitted_at: !isInProgress ? r.submitted_at || null : null,
    submission_id: !isInProgress ? r.submission_id || null : null,
    score: !isInProgress && r.score !== null && r.score !== undefined ? Number(r.score) : null,
    time_spent_seconds: !isInProgress ? Number(r.time_spent_seconds) || 0 : null,
    tab_switch_count: tabSwitchCount,
    unfocused_seconds: unfocusedSeconds,
    is_unfocused: isInProgress && Number(r.is_unfocused) === 1 ? 1 : 0,
    is_suspended: isSuspended ? 1 : 0,
    suspend_reason: r.attempt_suspend_reason || r.sub_suspend_reason || null,
    last_violation_at: r.last_violation_at || null,
    last_violation_reason: r.last_violation_reason || null,
    pending_violation_count: Number(vCounts[0]?.pending_cnt) || 0,
    confirmed_violation_count: Number(vCounts[0]?.confirmed_cnt) || 0,
    dismissed_violation_count: Number(vCounts[0]?.dismissed_cnt) || 0,
  };
}

export async function getExamLiveProctoringData(examId) {
  const numericExamId = Number(examId);
  const [examRows] = await pool.query(
    `SELECT e.id, e.title, e.duration_minutes, e.pass_score, e.is_published,
            e.anti_cheat, e.max_tab_switches, e.open_at, e.close_at,
            e.exam_session, e.exam_shift,
            s.code AS subject_code, s.name AS subject_name
     FROM exams e
     INNER JOIN subjects s ON e.subject_id = s.id
     WHERE e.id = ?
     LIMIT 1`,
    [numericExamId]
  );

  if (!examRows.length) {
    return null;
  }

  const exam = examRows[0];

  const [participantIdsRows] = await pool.query(
    `SELECT DISTINCT user_id FROM (
       SELECT user_id FROM exam_attempts WHERE exam_id = ?
       UNION
       SELECT student_id AS user_id FROM submissions WHERE exam_id = ?
     ) p`,
    [numericExamId, numericExamId]
  );

  const students = [];
  for (const p of participantIdsRows) {
    const row = await getStudentLiveRow(pool, numericExamId, p.user_id);
    if (row) students.push(row);
  }

  const statusOrder = { UNFOCUSED: 0, WORKING: 1, SUSPENDED: 2, SUBMITTED: 3 };
  students.sort((a, b) => {
    const ordDiff = (statusOrder[a.live_status] ?? 9) - (statusOrder[b.live_status] ?? 9);
    if (ordDiff !== 0) return ordDiff;
    if (b.tab_switch_count !== a.tab_switch_count) {
      return b.tab_switch_count - a.tab_switch_count;
    }
    return String(a.student_code || "").localeCompare(String(b.student_code || ""));
  });

  const [violationRows] = await pool.query(
    `SELECT
       vl.id,
       vl.exam_id,
       vl.user_id,
       vl.reason,
       vl.unfocused_seconds_snapshot,
       vl.status,
       vl.reviewed_by,
       vl.reviewed_by_name,
       vl.reviewed_at,
       vl.created_at,
       u.full_name,
       u.student_code,
       u.major_group
     FROM exam_violation_logs vl
     INNER JOIN users u ON vl.user_id = u.id
     LEFT JOIN exam_attempts ea
       ON ea.exam_id = vl.exam_id AND ea.user_id = vl.user_id
     WHERE vl.exam_id = ?
       AND (ea.started_at IS NULL OR vl.created_at >= DATE_SUB(ea.started_at, INTERVAL 2 SECOND))
     ORDER BY vl.id DESC
     LIMIT 200`,
    [numericExamId]
  );

  let workingCount = 0;
  let unfocusedCount = 0;
  let submittedCount = 0;
  let suspendedCount = 0;

  for (const st of students) {
    if (st.live_status === "WORKING") workingCount++;
    else if (st.live_status === "UNFOCUSED") unfocusedCount++;
    else if (st.live_status === "SUBMITTED") submittedCount++;
    else if (st.live_status === "SUSPENDED") suspendedCount++;
  }

  const pendingViolationCount = violationRows.filter((v) => v.status === "PENDING").length;

  return {
    exam,
    students,
    violations: violationRows,
    summary: {
      workingCount,
      unfocusedCount,
      submittedCount,
      suspendedCount,
      pendingViolationCount,
      totalViolationCount: violationRows.length,
    },
  };
}

export async function updateStudentFocusState({
  examId,
  userId,
  isFocused,
  unfocusedSeconds = 0,
}) {
  if (!isId(examId) || !isId(userId)) return null;
  const [exams] = await pool.query(
    "SELECT duration_minutes FROM exams WHERE id = ? LIMIT 1",
    [Number(examId)]
  );
  if (!exams.length) return null;

  const maxDurationSec = (Number(exams[0].duration_minutes) || 30) * 60;
  const safeUnfocused =
    isNumber(unfocusedSeconds) && Number(unfocusedSeconds) >= 0
      ? Math.min(maxDurationSec, Math.floor(Number(unfocusedSeconds)))
      : 0;

  await pool.query(
    `UPDATE exam_attempts
     SET is_unfocused = ?,
         unfocused_seconds = GREATEST(unfocused_seconds, ?)
     WHERE exam_id = ? AND user_id = ? AND status = 'IN_PROGRESS'`,
    [isFocused ? 0 : 1, safeUnfocused, Number(examId), Number(userId)]
  );

  return getStudentLiveRow(pool, Number(examId), Number(userId));
}

export async function recordViolationWithLog({
  examId,
  userId,
  reason,
  unfocusedSeconds = 0,
  answers = null,
  clientEventId = null,
}) {
  const numericExamId = Number(examId);
  const numericUserId = Number(userId);
  const cleanReason = String(reason || "Rời tab / Vi phạm quy chế")
    .trim()
    .slice(0, 255);
  const cleanEventId =
    clientEventId && typeof clientEventId === "string"
      ? clientEventId.trim().slice(0, 64) || null
      : null;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [exams] = await connection.query(
      `SELECT id, duration_minutes, max_tab_switches, anti_cheat
       FROM exams
       WHERE id = ?`,
      [numericExamId]
    );
    if (!exams.length) {
      await connection.rollback();
      return { notFound: true };
    }

    const isAntiCheatEnabled = Boolean(Number(exams[0].anti_cheat));
    if (!isAntiCheatEnabled) {
      await connection.rollback();
      return {
        antiCheatEnabled: false,
        isSuspended: false,
        tabSwitchCount: 0,
        maxTabSwitches: null,
        forceSubmit: false,
        violationLog: null,
        studentRow: null,
      };
    }

    const rawMaxAllowed = Number(exams[0].max_tab_switches);
    const maxAllowed =
      Number.isInteger(rawMaxAllowed) && rawMaxAllowed >= 1 ? rawMaxAllowed : 3;

    const [existingAttempt] = await connection.query(
      `SELECT
         started_at,
         TIMESTAMPDIFF(SECOND, started_at, NOW()) AS elapsed_seconds,
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
      [numericExamId, numericUserId]
    );

    if (existingAttempt.length > 0 && Number(existingAttempt[0].is_suspended) === 1) {
      await connection.commit();
      return {
        antiCheatEnabled: true,
        isSuspended: true,
        suspendReason: existingAttempt[0].suspend_reason || "Vi phạm quy chế phòng thi",
        tabSwitchCount: Math.max(0, Number(existingAttempt[0].tab_switch_count) || 0),
        maxTabSwitches: maxAllowed,
        forceSubmit: true,
        violationLog: null,
        studentRow: null,
      };
    }

    if (existingAttempt.length > 0 && existingAttempt[0].status === "COMPLETED") {
      const [lastSub] = await connection.query(
        "SELECT id FROM submissions WHERE exam_id = ? AND student_id = ? ORDER BY id DESC LIMIT 1",
        [numericExamId, numericUserId]
      );
      await connection.commit();
      return {
        antiCheatEnabled: true,
        isSuspended: false,
        tabSwitchCount: Math.max(0, Number(existingAttempt[0].tab_switch_count) || 0),
        maxTabSwitches: maxAllowed,
        forceSubmit: true,
        submissionId: lastSub[0]?.id || null,
        violationLog: null,
        studentRow: null,
      };
    }

    if (cleanEventId) {
      const [dupRows] = await connection.query(
        "SELECT id FROM exam_violation_logs WHERE client_event_id = ? LIMIT 1",
        [cleanEventId]
      );
      if (dupRows.length > 0) {
        const currentTabCount = Math.max(
          0,
          Number(existingAttempt[0]?.tab_switch_count) || 0
        );
        await connection.commit();
        return {
          antiCheatEnabled: true,
          deduplicated: true,
          isSuspended: false,
          tabSwitchCount: currentTabCount,
          maxTabSwitches: maxAllowed,
          forceSubmit: currentTabCount > maxAllowed,
          submissionId: null,
          violationLog: null,
          studentRow: null,
        };
      }
    }

    const maxDurationSec = (Number(exams[0].duration_minutes) || 30) * 60;
    const safeUnfocused =
      isNumber(unfocusedSeconds) && Number(unfocusedSeconds) >= 0
        ? Math.min(maxDurationSec, Math.floor(Number(unfocusedSeconds)))
        : 0;

    let mergedDraftJson = existingAttempt[0]?.draft_answers_json ?? null;
    const elapsedSec = Math.max(0, Number(existingAttempt[0]?.elapsed_seconds) || 0);
    if (
      answers &&
      typeof answers === "object" &&
      !Array.isArray(answers) &&
      elapsedSec <= maxDurationSec + NETWORK_GRACE_SECONDS
    ) {
      const existingBp = parseAttemptBlueprint(
        existingAttempt[0]?.attempt_blueprint_json
      );
      let validIds;
      if (existingBp) {
        validIds = new Set(existingBp.items.map((it) => String(it.questionId)));
      } else {
        const [qRows] = await connection.query(
          "SELECT question_id FROM exam_questions WHERE exam_id = ?",
          [numericExamId]
        );
        validIds = new Set(qRows.map((r) => String(r.question_id)));
      }
      const prevDraft = sanitizeAnswersMap(mergedDraftJson, validIds);
      const nextDraft = sanitizeAnswersMap(answers, validIds);
      const combined = Object.keys(nextDraft).length > 0 ? nextDraft : prevDraft;
      mergedDraftJson = JSON.stringify(combined);
    } else if (mergedDraftJson && typeof mergedDraftJson === "object") {
      mergedDraftJson = JSON.stringify(mergedDraftJson);
    }

    if (!existingAttempt.length) {
      await connection.query(
        `INSERT INTO exam_attempts
          (exam_id, user_id, started_at, status, tab_switch_count, unfocused_seconds, is_unfocused, draft_answers_json, last_violation_at, last_violation_reason)
         VALUES (?, ?, NOW(), 'IN_PROGRESS', 0, ?, 1, ?, NOW(), ?)`,
        [numericExamId, numericUserId, safeUnfocused, mergedDraftJson, cleanReason]
      );
    }

    const [attemptAnchor] = await connection.query(
      "SELECT started_at, unfocused_seconds FROM exam_attempts WHERE exam_id = ? AND user_id = ? LIMIT 1",
      [numericExamId, numericUserId]
    );
    const attemptStartedAt = attemptAnchor[0]?.started_at || null;
    const effectiveUnfocused = Math.max(
      safeUnfocused,
      Number(attemptAnchor[0]?.unfocused_seconds) || 0
    );

    const [logInsert] = await connection.query(
      `INSERT INTO exam_violation_logs
        (exam_id, user_id, client_event_id, reason, unfocused_seconds_snapshot, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', NOW())`,
      [
        numericExamId,
        numericUserId,
        cleanEventId,
        cleanReason,
        effectiveUnfocused,
      ]
    );

    const [validCountRows] = await connection.query(
      `SELECT COUNT(*) AS cnt
       FROM exam_violation_logs
       WHERE exam_id = ?
         AND user_id = ?
         AND status IN ('PENDING', 'CONFIRMED')
         AND (? IS NULL OR created_at >= DATE_SUB(?, INTERVAL 2 SECOND))`,
      [numericExamId, numericUserId, attemptStartedAt, attemptStartedAt]
    );
    const tabSwitchCount = Math.max(1, Number(validCountRows[0]?.cnt) || 1);

    await connection.query(
      `UPDATE exam_attempts
       SET tab_switch_count = ?,
           unfocused_seconds = GREATEST(unfocused_seconds, ?),
           draft_answers_json = COALESCE(?, draft_answers_json),
           last_violation_at = NOW(),
           last_violation_reason = ?
       WHERE exam_id = ? AND user_id = ?`,
      [
        tabSwitchCount,
        safeUnfocused,
        mergedDraftJson,
        cleanReason,
        numericExamId,
        numericUserId,
      ]
    );

    const [insertedLogs] = await connection.query(
      `SELECT
         vl.id,
         vl.exam_id,
         vl.user_id,
         vl.reason,
         vl.unfocused_seconds_snapshot,
         vl.status,
         vl.reviewed_by,
         vl.reviewed_by_name,
         vl.reviewed_at,
         vl.created_at,
         u.full_name,
         u.student_code,
         u.major_group
       FROM exam_violation_logs vl
       INNER JOIN users u ON vl.user_id = u.id
       WHERE vl.id = ?
       LIMIT 1`,
      [logInsert.insertId]
    );

    const studentRow = await getStudentLiveRow(connection, numericExamId, numericUserId);
    const forceSubmit = tabSwitchCount > maxAllowed;

    await connection.commit();
    return {
      antiCheatEnabled: true,
      isSuspended: false,
      tabSwitchCount,
      maxTabSwitches: maxAllowed,
      forceSubmit,
      submissionId: null,
      violationLog: insertedLogs[0] || null,
      studentRow,
    };
  } catch (error) {
    if (connection) await connection.rollback();
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

export async function reviewViolationLog({
  examId,
  violationId,
  decision,
  reviewer,
}) {
  const numericExamId = Number(examId);
  const numericViolationId = Number(violationId);
  const normalizedDecision =
    decision === "DISMISSED" || decision === "IGNORE"
      ? "DISMISSED"
      : decision === "CONFIRMED" || decision === "CONFIRM"
      ? "CONFIRMED"
      : null;

  if (!isId(numericExamId) || !isId(numericViolationId) || !normalizedDecision) {
    const err = new Error("Thông tin duyệt vi phạm không hợp lệ.");
    err.statusCode = 400;
    throw err;
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [vRows] = await connection.query(
      `SELECT vl.*, e.title AS exam_title, e.max_tab_switches, e.anti_cheat, s.code AS subject_code
       FROM exam_violation_logs vl
       INNER JOIN exams e ON vl.exam_id = e.id
       INNER JOIN subjects s ON e.subject_id = s.id
       WHERE vl.id = ? AND vl.exam_id = ?
       FOR UPDATE`,
      [numericViolationId, numericExamId]
    );

    if (!vRows.length) {
      await connection.rollback();
      const err = new Error("Không tìm thấy log vi phạm cần duyệt.");
      err.statusCode = 404;
      throw err;
    }

    const targetLog = vRows[0];
    const targetUserId = Number(targetLog.user_id);
    const reviewerName = reviewer?.fullName || "Giám thị";

    await connection.query(
      `UPDATE exam_violation_logs
       SET status = ?,
           reviewed_by = ?,
           reviewed_by_name = ?,
           reviewed_at = NOW()
       WHERE id = ?`,
      [normalizedDecision, reviewer?.id || null, reviewerName, numericViolationId]
    );

    const [attemptRows] = await connection.query(
      `SELECT started_at, status
       FROM exam_attempts
       WHERE exam_id = ? AND user_id = ?
       FOR UPDATE`,
      [numericExamId, targetUserId]
    );
    const attemptStartedAt = attemptRows[0]?.started_at || null;
    const attemptStatus = attemptRows[0]?.status || null;

    const [validCountRows] = await connection.query(
      `SELECT COUNT(*) AS cnt
       FROM exam_violation_logs
       WHERE exam_id = ?
         AND user_id = ?
         AND status IN ('PENDING', 'CONFIRMED')
         AND (? IS NULL OR created_at >= DATE_SUB(?, INTERVAL 2 SECOND))`,
      [numericExamId, targetUserId, attemptStartedAt, attemptStartedAt]
    );
    const validViolationCount = Math.max(0, Number(validCountRows[0]?.cnt) || 0);

    await connection.query(
      `UPDATE exam_attempts
       SET tab_switch_count = ?
       WHERE exam_id = ? AND user_id = ?`,
      [validViolationCount, numericExamId, targetUserId]
    );

    if (attemptStatus === "COMPLETED") {
      const [latestSub] = await connection.query(
        `SELECT id FROM submissions
         WHERE exam_id = ? AND student_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [numericExamId, targetUserId]
      );
      if (latestSub.length > 0) {
        await connection.query(
          "UPDATE submissions SET tab_switch_count = ? WHERE id = ?",
          [validViolationCount, latestSub[0].id]
        );
      }
    }

    const [updatedLogs] = await connection.query(
      `SELECT
         vl.id,
         vl.exam_id,
         vl.user_id,
         vl.reason,
         vl.unfocused_seconds_snapshot,
         vl.status,
         vl.reviewed_by,
         vl.reviewed_by_name,
         vl.reviewed_at,
         vl.created_at,
         u.full_name,
         u.student_code,
         u.major_group
       FROM exam_violation_logs vl
       INNER JOIN users u ON vl.user_id = u.id
       WHERE vl.id = ?
       LIMIT 1`,
      [numericViolationId]
    );

    const updatedLog = updatedLogs[0];

    await connection.query(
      `INSERT INTO admin_logs (admin_id, admin_name, action_type, exam_title, subject_code, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        reviewer?.id || null,
        reviewerName,
        normalizedDecision === "DISMISSED" ? "DISMISS_VIOLATION" : "CONFIRM_VIOLATION",
        targetLog.exam_title,
        targetLog.subject_code || null,
        `${
          normalizedDecision === "DISMISSED" ? "Bỏ qua lỗi" : "Xác nhận vi phạm"
        } "${targetLog.reason}" cho SV ${updatedLog.full_name} (${
          updatedLog.student_code || targetUserId
        }) — Số lỗi hợp lệ: ${validViolationCount}`,
      ]
    );

    const studentRow = await getStudentLiveRow(connection, numericExamId, targetUserId);
    const rawMaxAllowed = Number(targetLog.max_tab_switches);
    const maxTabSwitches =
      Number.isInteger(rawMaxAllowed) && rawMaxAllowed >= 1 ? rawMaxAllowed : 3;
    const forceSubmit =
      Boolean(Number(targetLog.anti_cheat)) &&
      attemptStatus === "IN_PROGRESS" &&
      validViolationCount > maxTabSwitches;

    await connection.commit();

    return {
      violationLog: updatedLog,
      studentRow,
      validViolationCount,
      maxTabSwitches,
      forceSubmit,
      decision: normalizedDecision,
    };
  } catch (error) {
    if (connection) await connection.rollback();
    throw error;
  } finally {
    if (connection) connection.release();
  }
}
