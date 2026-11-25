import { pool } from "../config/db.js";
import { validateExam } from "../utils/validation.js";

async function logAdminAction(
  dbClient,
  { user, actionType, examTitle, subjectCode = null, details = null }
) {
  await dbClient.query(
    `INSERT INTO admin_logs (admin_id, admin_name, action_type, exam_title, subject_code, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      user?.id || null,
      user?.fullName || "Quản trị viên",
      actionType,
      examTitle,
      subjectCode,
      details,
    ]
  );
}

function shuffleArray(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function resolveStudentMajorGroup(user) {
  if (!user || user.role !== "STUDENT") return null;
  if (user.majorGroup) return user.majorGroup;
  const [rows] = await pool.query("SELECT major_group FROM users WHERE id = ?", [user.id]);
  return rows[0]?.major_group || null;
}

export async function getExams(req, res, next) {
  try {
    const { subjectId, search, publishedOnly, majorGroup } = req.query;

    let sql = `
      SELECT
        e.*,
        s.name AS subject_name,
        s.code AS subject_code,
        u.full_name AS teacher_name,
        (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id) AS question_count,
        (SELECT GROUP_CONCAT(eq.question_id ORDER BY eq.order_index ASC) FROM exam_questions eq WHERE eq.exam_id = e.id) AS question_ids_csv,
        (SELECT COUNT(*) FROM submissions sub WHERE sub.exam_id = e.id) AS submission_count
      FROM exams e
      INNER JOIN subjects s ON e.subject_id = s.id
      LEFT JOIN users u ON e.created_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (publishedOnly === "true" || req.user?.role === "STUDENT") {
      sql += " AND e.is_published = 1";
    }
    if (req.user?.role === "STUDENT") {
      const studentMajorGroup = await resolveStudentMajorGroup(req.user);
      if (studentMajorGroup) {
        sql += " AND (e.major_group = 'ALL' OR e.major_group = ?)";
        params.push(studentMajorGroup);
      } else {
        sql += " AND e.major_group = 'ALL'";
      }
    } else if (majorGroup && ["ALL", "KY_THUAT", "KINH_TE"].includes(majorGroup)) {
      sql += " AND e.major_group = ?";
      params.push(majorGroup);
    }
    if (subjectId) {
      sql += " AND e.subject_id = ?";
      params.push(Number(subjectId));
    }
    if (search) {
      sql += " AND (e.title LIKE ? OR s.name LIKE ?)";
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    sql += " ORDER BY e.id DESC";

    const [rows] = await pool.query(sql, params);
    const formatted = rows.map(({ question_ids_csv, ...rest }) => {
      const antiCheatEnabled = Boolean(Number(rest.anti_cheat));
      return {
        ...rest,
        anti_cheat: antiCheatEnabled ? 1 : 0,
        max_tab_switches: antiCheatEnabled
          ? Number(rest.max_tab_switches) >= 1
            ? Number(rest.max_tab_switches)
            : 3
          : null,
        question_ids: question_ids_csv
          ? String(question_ids_csv)
              .split(",")
              .map(Number)
              .filter(Boolean)
          : [],
      };
    });
    return res.status(200).json({
      success: true,
      data: formatted,
    });
  } catch (error) {
    next(error);
  }
}

export async function getExamById(req, res, next) {
  try {
    const { id } = req.params;
    const { mode } = req.query;

    const [examRows] = await pool.query(
      `
      SELECT
        e.*,
        s.name AS subject_name,
        s.code AS subject_code,
        u.full_name AS teacher_name
      FROM exams e
      INNER JOIN subjects s ON e.subject_id = s.id
      LEFT JOIN users u ON e.created_by = u.id
      WHERE e.id = ?
      `,
      [id]
    );

    if (examRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đề thi này.",
      });
    }

    const exam = examRows[0];
    const isAntiCheatExam = Boolean(Number(exam.anti_cheat));
    exam.anti_cheat = isAntiCheatExam ? 1 : 0;
    exam.max_tab_switches = isAntiCheatExam
      ? Number(exam.max_tab_switches) >= 1
        ? Number(exam.max_tab_switches)
        : 3
      : null;
    const hasMaxAttempts = Number(exam.max_attempts) >= 1;

    if (req.user.role === "STUDENT") {
      if (!exam.is_published) {
        return res.status(403).json({ success: false, message: "Đề thi này chưa được mở." });
      }
      const now = new Date();
      if (exam.open_at && now < new Date(exam.open_at)) {
        return res.status(403).json({
          success: false,
          message: `Đề thi chưa đến thời gian mở (${new Date(exam.open_at).toLocaleString("vi-VN")}).`,
        });
      }
      if (exam.close_at && now > new Date(exam.close_at)) {
        return res.status(403).json({
          success: false,
          message: "Đề thi đã hết hạn đóng đề.",
        });
      }
      const studentMajorGroup = await resolveStudentMajorGroup(req.user);
      if (exam.major_group && exam.major_group !== "ALL" && exam.major_group !== studentMajorGroup) {
        return res.status(403).json({
          success: false,
          message: "Đề thi này không thuộc khối ngành của bạn.",
        });
      }

      const [existingAttempt] = await pool.query(
        "SELECT started_at, status, is_suspended, suspend_reason FROM exam_attempts WHERE exam_id = ? AND user_id = ? LIMIT 1",
        [id, req.user.id]
      );

      if (existingAttempt.length > 0 && Number(existingAttempt[0].is_suspended) === 1) {
        if (
          !isAntiCheatExam &&
          String(existingAttempt[0].suspend_reason || "").startsWith("Vượt quá giới hạn rời tab")
        ) {
          await pool.query(
            `UPDATE exam_attempts
             SET is_suspended = 0,
                 suspend_reason = NULL,
                 tab_switch_count = 0,
                 last_violation_at = NULL,
                 last_violation_reason = NULL
             WHERE exam_id = ? AND user_id = ?`,
            [id, req.user.id]
          );
          existingAttempt[0].is_suspended = 0;
          existingAttempt[0].suspend_reason = null;
        } else {
          const reason = existingAttempt[0].suspend_reason || "Vi phạm quy chế phòng thi";
          return res.status(403).json({
            success: false,
            isSuspended: true,
            suspendReason: reason,
            message: `Bài thi của bạn đã bị Giám thị đình chỉ (0 điểm). Lý do: ${reason}`,
          });
        }
      }

      if (
        existingAttempt.length > 0 &&
        existingAttempt[0].status === "IN_PROGRESS" &&
        existingAttempt[0].started_at
      ) {
        const prevStartedMs = new Date(existingAttempt[0].started_at).getTime();
        const maxDurationSec = (Number(exam.duration_minutes) || 30) * 60;
        if (
          Number.isFinite(prevStartedMs) &&
          Date.now() > prevStartedMs + (maxDurationSec + 30) * 1000
        ) {
          const [qCntRows] = await pool.query(
            "SELECT COUNT(*) AS cnt FROM exam_questions WHERE exam_id = ?",
            [id]
          );
          await pool.query(
            `INSERT INTO submissions
              (exam_id, student_id, score, correct_count, total_questions, time_spent_seconds, started_at, tab_switch_count, answers_json)
             VALUES (?, ?, 0, 0, ?, ?, ?, 0, '{}')`,
            [
              Number(id),
              req.user.id,
              Number(qCntRows[0]?.cnt) || 0,
              maxDurationSec,
              new Date(prevStartedMs),
            ]
          );
          await pool.query(
            "UPDATE exam_attempts SET status = 'COMPLETED' WHERE exam_id = ? AND user_id = ?",
            [id, req.user.id]
          );
        }
      }

      if (hasMaxAttempts) {
        const [attemptRows] = await pool.query(
          "SELECT COUNT(*) AS cnt FROM submissions WHERE exam_id = ? AND student_id = ?",
          [id, req.user.id]
        );
        if (Number(attemptRows[0].cnt) >= Number(exam.max_attempts)) {
          return res.status(403).json({
            success: false,
            message: `Bạn đã sử dụng hết ${exam.max_attempts} lượt làm bài cho đề thi này.`,
          });
        }
      }
    }

    const [[qCountRow], [subCountRow], [mySubCountRow]] = await Promise.all([
      pool.query("SELECT COUNT(*) AS cnt FROM exam_questions WHERE exam_id = ?", [id]),
      pool.query("SELECT COUNT(*) AS cnt FROM submissions WHERE exam_id = ?", [id]),
      pool.query("SELECT COUNT(*) AS cnt FROM submissions WHERE exam_id = ? AND student_id = ?", [
        id,
        req.user.id,
      ]),
    ]);

    const questionCount = Number(qCountRow[0]?.cnt || 0);
    const submissionCount = Number(subCountRow[0]?.cnt || 0);
    const myAttemptCount = Number(mySubCountRow[0]?.cnt || 0);

    if (mode === "preview") {
      return res.status(200).json({
        success: true,
        data: {
          ...exam,
          question_count: questionCount,
          submission_count: submissionCount,
          my_attempt_count: myAttemptCount,
        },
      });
    }

    const [questionRows] = await pool.query(
      `
      SELECT
        q.id,
        q.subject_id,
        q.content,
        q.option_a,
        q.option_b,
        q.option_c,
        q.option_d,
        q.difficulty,
        q.correct_answer,
        q.explanation,
        eq.order_index
      FROM exam_questions eq
      INNER JOIN questions q ON eq.question_id = q.id
      WHERE eq.exam_id = ?
      ORDER BY eq.order_index ASC, q.id ASC
      `,
      [id]
    );

    const isStudentTaking = req.user?.role === "STUDENT" || mode === "take";
    let formattedQuestions = questionRows.map((q) => {
      if (isStudentTaking) {
        return {
          id: q.id,
          subject_id: q.subject_id,
          content: q.content,
          option_a: q.option_a,
          option_b: q.option_b,
          option_c: q.option_c,
          option_d: q.option_d,
          difficulty: q.difficulty,
          order_index: q.order_index,
        };
      }
      return q;
    });

    if (isStudentTaking && Boolean(exam.shuffle_questions)) {
      formattedQuestions = shuffleArray(formattedQuestions);
    }

    let currentTabSwitchCount = 0;
    let activeStartedAt = null;
    const baseDurationSec = (Number(exam.duration_minutes) || 30) * 60;
    let effectiveDurationSeconds = baseDurationSec;
    if (req.user?.role === "STUDENT") {
      const nowDate = new Date();
      await pool.query(
        `INSERT INTO exam_attempts (exam_id, user_id, started_at, status, tab_switch_count, last_violation_at, last_violation_reason)
         VALUES (?, ?, ?, 'IN_PROGRESS', 0, NULL, NULL)
         ON DUPLICATE KEY UPDATE
           started_at = IF(status = 'IN_PROGRESS', started_at, VALUES(started_at)),
           tab_switch_count = IF(status = 'IN_PROGRESS', tab_switch_count, 0),
           last_violation_at = IF(status = 'IN_PROGRESS', last_violation_at, NULL),
           last_violation_reason = IF(status = 'IN_PROGRESS', last_violation_reason, NULL),
           status = 'IN_PROGRESS'`,
        [id, req.user.id, nowDate]
      );

      const [activeAttempt] = await pool.query(
        "SELECT started_at, tab_switch_count FROM exam_attempts WHERE exam_id = ? AND user_id = ? LIMIT 1",
        [id, req.user.id]
      );
      currentTabSwitchCount = isAntiCheatExam
        ? Math.max(0, Number(activeAttempt[0]?.tab_switch_count) || 0)
        : 0;
      if (activeAttempt[0]?.started_at) {
        activeStartedAt = new Date(activeAttempt[0].started_at).toISOString();
      }
      if (exam.close_at) {
        const closeAtMs = new Date(exam.close_at).getTime();
        const startMs = activeStartedAt ? new Date(activeStartedAt).getTime() : Date.now();
        if (Number.isFinite(closeAtMs) && Number.isFinite(startMs)) {
          const remainingToCloseSec = Math.max(1, Math.floor((closeAtMs - startMs) / 1000));
          effectiveDurationSeconds = Math.min(baseDurationSec, remainingToCloseSec);
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        ...exam,
        question_count: questionCount,
        submission_count: submissionCount,
        my_attempt_count: myAttemptCount,
        started_at: activeStartedAt,
        effective_duration_seconds: effectiveDurationSeconds,
        current_tab_switch_count: currentTabSwitchCount,
        questions: formattedQuestions,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function createExam(req, res, next) {
  return saveExam(req, res, next, false);
}

export async function updateExam(req, res, next) {
  return saveExam(req, res, next, true);
}

async function saveExam(req, res, next, isUpdate) {
  let connection;
  try {
    const {
      subjectId,
      title,
      description = "",
      durationMinutes,
      passScore,
      isPublished,
      majorGroup = "ALL",
      sessionMode = "FREE",
      examSession = "",
      examShift = "",
      shuffleQuestions = 0,
      shuffleOptions = 0,
      antiCheat = 0,
      maxTabSwitches = null,
      maxAttempts = null,
      openAt = null,
      closeAt = null,
      questionIds,
    } = req.body;

    const resolveMaxTabSwitches = (antiCheatFlag, val) => {
      if (!antiCheatFlag) return null;
      if (val === null || val === undefined || val === "") return 3;
      const num = Number(val);
      return Number.isInteger(num) && num >= 1 ? num : 3;
    };

    const parseOptionalAttempts = (val) => {
      if (val === null || val === undefined || val === "") return null;
      const num = Number(val);
      return num >= 1 ? num : null;
    };

    const cleanSession = String(examSession || "").trim() || null;
    const cleanShift = cleanSession ? String(examShift || "").trim() || null : null;
    const resolvedOpenAt = openAt ? new Date(openAt) : null;
    const resolvedCloseAt = closeAt ? new Date(closeAt) : null;

    connection = await pool.getConnection();
    await connection.beginTransaction();

    let hasSubmissions = false;
    if (isUpdate) {
      const [exams] = await connection.query("SELECT id FROM exams WHERE id = ? FOR UPDATE", [req.params.id]);
      if (!exams.length) throw Object.assign(new Error("Không tìm thấy đề thi."), { statusCode: 404 });
      const [submissions] = await connection.query("SELECT id FROM submissions WHERE exam_id = ? LIMIT 1", [req.params.id]);
      hasSubmissions = submissions.length > 0;
    }

    const message = validateExam(req.body, { isMetadataOnly: isUpdate && hasSubmissions });
    if (message) {
      await connection.rollback();
      return res.status(400).json({ success: false, message });
    }

    if (isUpdate && hasSubmissions) {
      const [metaRows] = await connection.query(
        `SELECT s.code AS subject_code
         FROM exams e
         INNER JOIN subjects s ON e.subject_id = s.id
         WHERE e.id = ?`,
        [req.params.id]
      );
      await connection.query(
        `UPDATE exams
         SET title = ?, description = ?, is_published = ?,
             exam_session = ?, exam_shift = ?,
             shuffle_questions = ?, shuffle_options = ?, anti_cheat = ?,
             max_tab_switches = ?, max_attempts = ?,
             open_at = ?, close_at = ?
         WHERE id = ?`,
        [
          title.trim(),
          description.trim(),
          isPublished ? 1 : 0,
          cleanSession,
          cleanShift,
          shuffleQuestions ? 1 : 0,
          shuffleOptions ? 1 : 0,
          antiCheat ? 1 : 0,
          resolveMaxTabSwitches(Boolean(antiCheat), maxTabSwitches),
          parseOptionalAttempts(maxAttempts),
          resolvedOpenAt,
          resolvedCloseAt,
          req.params.id,
        ]
      );
      await logAdminAction(connection, {
        user: req.user,
        actionType: "UPDATE_EXAM",
        examTitle: title.trim(),
        subjectCode: metaRows[0]?.subject_code || null,
        details: "Cập nhật thông tin quản trị đề thi (giữ nguyên câu hỏi do đã có bài nộp)",
      });
      await connection.commit();
      return res.status(200).json({
        success: true,
        message: "Đã cập nhật thông tin quản trị của đề thi (danh sách câu hỏi được giữ nguyên để bảo toàn lịch sử điểm).",
        data: { id: Number(req.params.id), metadataOnly: true },
      });
    }

    const [subjects] = await connection.query("SELECT id, code FROM subjects WHERE id = ?", [Number(subjectId)]);
    if (!subjects.length) throw Object.assign(new Error("Môn học không tồn tại."), { statusCode: 400 });
    const subjectCode = subjects[0].code;

    let finalDuration = Number(durationMinutes);
    let finalPassScore = Number(passScore);
    let finalMajorGroup = majorGroup;
    let finalShuffleQuestions = shuffleQuestions ? 1 : 0;
    let finalShuffleOptions = shuffleOptions ? 1 : 0;
    let finalAntiCheat = antiCheat ? 1 : 0;
    let finalMaxTabSwitches = resolveMaxTabSwitches(Boolean(antiCheat), maxTabSwitches);
    let finalMaxAttempts = parseOptionalAttempts(maxAttempts);

    if (!isUpdate && sessionMode === "NEW_SESSION") {
      if (!cleanSession) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Vui lòng nhập tên đợt thi mới.",
        });
      }
      const [dupSession] = await connection.query(
        `SELECT id FROM exams
         WHERE subject_id = ? AND LOWER(TRIM(exam_session)) = LOWER(?)
         LIMIT 1`,
        [Number(subjectId), cleanSession]
      );
      if (dupSession.length > 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Tên đợt thi đã tồn tại trong môn học này, không được phép tạo trùng!",
        });
      }
    }

    if (!isUpdate && cleanSession) {
      const [templateRows] = await connection.query(
        `SELECT e.*,
                (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id) AS question_count
         FROM exams e
         WHERE e.subject_id = ? AND LOWER(TRIM(e.exam_session)) = LOWER(?)
         ORDER BY e.id ASC
         LIMIT 1`,
        [Number(subjectId), cleanSession]
      );
      if (templateRows.length > 0) {
        if (!cleanShift) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: "Vui lòng nhập tên ca thi khi thêm ca vào đợt thi có sẵn.",
          });
        }
        const [dupShift] = await connection.query(
          `SELECT id FROM exams
           WHERE subject_id = ?
             AND LOWER(TRIM(exam_session)) = LOWER(?)
             AND LOWER(TRIM(COALESCE(exam_shift, ''))) = LOWER(?)
           LIMIT 1`,
          [Number(subjectId), cleanSession, cleanShift]
        );
        if (dupShift.length > 0) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: "Ca thi này đã tồn tại trong đợt thi, vui lòng đặt tên ca khác!",
          });
        }

        const tpl = templateRows[0];
        const requiredCount = Number(tpl.question_count);
        if (questionIds.length !== requiredCount) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: `Đợt thi "${cleanSession}" yêu cầu chọn đúng ${requiredCount} câu hỏi để đồng bộ với các ca trước.`,
          });
        }
        finalDuration = Number(tpl.duration_minutes);
        finalPassScore = Number(tpl.pass_score);
        finalMajorGroup = tpl.major_group;
        finalShuffleQuestions = tpl.shuffle_questions ? 1 : 0;
        finalShuffleOptions = tpl.shuffle_options ? 1 : 0;
        finalAntiCheat = tpl.anti_cheat ? 1 : 0;
        finalMaxTabSwitches = resolveMaxTabSwitches(Boolean(tpl.anti_cheat), tpl.max_tab_switches);
        finalMaxAttempts = parseOptionalAttempts(tpl.max_attempts);
      }
    }

    const [questions] = await connection.query(
      "SELECT id FROM questions WHERE subject_id = ? AND id IN (?) FOR UPDATE",
      [Number(subjectId), questionIds.map(Number)]
    );
    if (questions.length !== questionIds.length) {
      throw Object.assign(new Error("Tất cả câu hỏi phải tồn tại và thuộc môn học đã chọn."), { statusCode: 400 });
    }

    const values = [
      Number(subjectId),
      title.trim(),
      description.trim(),
      finalDuration,
      finalPassScore,
      isPublished ? 1 : 0,
      finalMajorGroup,
      cleanSession,
      cleanShift,
      finalShuffleQuestions,
      finalShuffleOptions,
      finalAntiCheat,
      finalMaxTabSwitches,
      finalMaxAttempts,
      resolvedOpenAt,
      resolvedCloseAt,
    ];
    let examId = req.params.id;
    if (isUpdate) {
      await connection.query(
        `UPDATE exams
         SET subject_id = ?, title = ?, description = ?, duration_minutes = ?, pass_score = ?,
             is_published = ?, major_group = ?, exam_session = ?, exam_shift = ?,
             shuffle_questions = ?, shuffle_options = ?, anti_cheat = ?,
             max_tab_switches = ?, max_attempts = ?, open_at = ?, close_at = ?
         WHERE id = ?`,
        [...values, examId]
      );
      await connection.query("DELETE FROM exam_questions WHERE exam_id = ?", [examId]);
    } else {
      const [result] = await connection.query(
        `INSERT INTO exams
          (subject_id, title, description, duration_minutes, pass_score, is_published, major_group,
           exam_session, exam_shift, shuffle_questions, shuffle_options, anti_cheat,
           max_tab_switches, max_attempts, open_at, close_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...values, req.user.id]
      );
      examId = result.insertId;
    }
    for (const [index, questionId] of questionIds.entries()) {
      await connection.query(
        "INSERT INTO exam_questions (exam_id, question_id, order_index) VALUES (?, ?, ?)",
        [examId, Number(questionId), index + 1]
      );
    }
    await logAdminAction(connection, {
      user: req.user,
      actionType: isUpdate ? "UPDATE_EXAM" : "CREATE_EXAM",
      examTitle: title.trim(),
      subjectCode,
      details: isUpdate
        ? `Cập nhật đề thi (${questionIds.length} câu hỏi, ${Number(durationMinutes)} phút)`
        : `Thêm đề mới gồm ${questionIds.length} câu hỏi (${Number(durationMinutes)} phút)`,
    });
    await connection.commit();
    return res.status(isUpdate ? 200 : 201).json({
      success: true,
      message: isUpdate ? "Cập nhật đề thi thành công!" : "Tạo đề thi thành công!",
      data: { id: Number(examId) },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    if (connection) connection.release();
  }
}

export async function deleteExam(req, res, next) {
  try {
    const { id } = req.params;
    const [used] = await pool.query("SELECT id FROM submissions WHERE exam_id = ? LIMIT 1", [id]);
    if (used.length) return res.status(409).json({ success: false, message: "Đề đã có bài nộp nên không thể xóa." });

    const [examInfo] = await pool.query(
      `SELECT e.title, s.code AS subject_code
       FROM exams e
       LEFT JOIN subjects s ON e.subject_id = s.id
       WHERE e.id = ?`,
      [id]
    );
    const [result] = await pool.query("DELETE FROM exams WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đề thi cần xóa.",
      });
    }

    if (examInfo.length > 0) {
      await logAdminAction(pool, {
        user: req.user,
        actionType: "DELETE_EXAM",
        examTitle: examInfo[0].title,
        subjectCode: examInfo[0].subject_code || null,
        details: "Xóa đề thi khỏi hệ thống",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Đã xóa đề thi thành công!",
    });
  } catch (error) {
    next(error);
  }
}

export async function reopenExam(req, res, next) {
  try {
    const { id } = req.params;
    const { closeAt } = req.body || {};

    const [rows] = await pool.query(
      `SELECT e.id, e.title, e.close_at, s.code AS subject_code
       FROM exams e
       LEFT JOIN subjects s ON e.subject_id = s.id
       WHERE e.id = ?`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Không tìm thấy đề thi." });
    }

    let nextCloseAt = rows[0].close_at;
    if (closeAt) {
      const parsed = new Date(closeAt);
      if (Number.isNaN(parsed.getTime()) || parsed <= new Date()) {
        return res.status(400).json({
          success: false,
          message: "Thời gian đóng đề mới phải là một mốc trong tương lai.",
        });
      }
      nextCloseAt = parsed;
    } else if (nextCloseAt && new Date(nextCloseAt) <= new Date()) {
      nextCloseAt = null;
    }

    await pool.query(
      "UPDATE exams SET is_published = 1, close_at = ? WHERE id = ?",
      [nextCloseAt, id]
    );

    await logAdminAction(pool, {
      user: req.user,
      actionType: "REOPEN_EXAM",
      examTitle: rows[0].title,
      subjectCode: rows[0].subject_code || null,
      details: nextCloseAt
        ? `Mở lại đề thi đến ${new Date(nextCloseAt).toLocaleString("vi-VN")}`
        : "Mở lại đề thi đã đóng (mở tự do)",
    });

    return res.status(200).json({
      success: true,
      message: nextCloseAt
        ? `Đã mở lại đề thi đến ${new Date(nextCloseAt).toLocaleString("vi-VN")}!`
        : "Đã mở lại đề thi thành công (mở tự do)!",
    });
  } catch (error) {
    next(error);
  }
}

export async function getAdminLogs(req, res, next) {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM admin_logs ORDER BY created_at DESC, id DESC LIMIT 100"
    );
    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
}

export async function getAdminExamOverview(req, res, next) {
  try {
    const now = new Date();
    const [rows] = await pool.query(`
      SELECT
        e.*,
        s.name AS subject_name,
        s.code AS subject_code,
        (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id) AS question_count,
        (SELECT GROUP_CONCAT(eq.question_id ORDER BY eq.order_index ASC) FROM exam_questions eq WHERE eq.exam_id = e.id) AS question_ids_csv,
        (SELECT COUNT(*) FROM submissions sub WHERE sub.exam_id = e.id) AS completed_count,
        (SELECT COUNT(*) FROM exam_attempts ea WHERE ea.exam_id = e.id AND ea.status = 'IN_PROGRESS' AND ea.started_at >= DATE_SUB(?, INTERVAL (e.duration_minutes + 5) MINUTE)) AS in_progress_count
      FROM exams e
      INNER JOIN subjects s ON e.subject_id = s.id
      ORDER BY e.id DESC
    `, [now]);

    const alwaysOpen = [];
    const inProgressWindow = [];
    const closed = [];

    for (const rawExam of rows) {
      const { question_ids_csv, ...rest } = rawExam;
      const exam = {
        ...rest,
        question_ids: question_ids_csv
          ? String(question_ids_csv)
              .split(",")
              .map(Number)
              .filter(Boolean)
          : [],
      };
      const openAt = exam.open_at ? new Date(exam.open_at) : null;
      const closeAt = exam.close_at ? new Date(exam.close_at) : null;
      const isPublished = Boolean(exam.is_published);

      if (!isPublished || (closeAt && closeAt < now)) {
        closed.push(exam);
      } else if (!openAt && !closeAt) {
        alwaysOpen.push(exam);
      } else {
        inProgressWindow.push(exam);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        alwaysOpen,
        inProgressWindow,
        closed,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getExamLeaderboard(req, res, next) {
  try {
    const { id } = req.params;
    const [examRows] = await pool.query(
      `SELECT e.*, s.name AS subject_name, s.code AS subject_code
       FROM exams e
       INNER JOIN subjects s ON e.subject_id = s.id
       WHERE e.id = ?`,
      [id]
    );

    if (!examRows.length) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đề thi.",
      });
    }
    const exam = examRows[0];

    const [subRows] = await pool.query(
      `SELECT
         sub.id AS submission_id,
         sub.student_id,
         sub.score,
         sub.correct_count,
         sub.total_questions,
         sub.time_spent_seconds,
         sub.started_at,
         sub.submitted_at,
         sub.tab_switch_count,
         sub.is_suspended,
         sub.suspend_reason,
         u.full_name,
         u.student_code,
         u.major_group
       FROM submissions sub
       INNER JOIN users u ON sub.student_id = u.id
       WHERE sub.exam_id = ?
       ORDER BY
         sub.score DESC,
         sub.time_spent_seconds ASC,
         sub.submitted_at ASC,
         sub.tab_switch_count ASC,
         u.student_code ASC`,
      [id]
    );

    const tieKey = (row) =>
      [
        Number(row.score).toFixed(2),
        Number(row.time_spent_seconds) || 0,
        row.submitted_at ? Math.floor(new Date(row.submitted_at).getTime() / 1000) : 0,
        Number(row.tab_switch_count) || 0,
      ].join("|");

    const keyCounts = new Map();
    for (const row of subRows) {
      const k = tieKey(row);
      keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
    }

    let currentRank = 0;
    let prevKey = null;
    const leaderboard = subRows.map((row, idx) => {
      const k = tieKey(row);
      if (k !== prevKey) {
        currentRank = idx + 1;
        prevKey = k;
      }
      return {
        ...row,
        rank: currentRank,
        is_tied: (keyCounts.get(k) || 0) > 1,
      };
    });

    const [inProgressRows] = await pool.query(
      `SELECT
         ea.id,
         ea.user_id,
         ea.started_at,
         u.full_name,
         u.student_code,
         u.major_group
       FROM exam_attempts ea
       INNER JOIN users u ON ea.user_id = u.id
       WHERE ea.exam_id = ?
         AND ea.status = 'IN_PROGRESS'
         AND ea.started_at >= DATE_SUB(?, INTERVAL ? MINUTE)
       ORDER BY ea.started_at ASC`,
      [id, new Date(), (Number(exam.duration_minutes) || 30) + 5]
    );

    const completedCount = leaderboard.length;
    const passScore = Number(exam.pass_score ?? 5);
    const passedCount = leaderboard.filter(
      (r) => Number(r.is_suspended) !== 1 && Number(r.score) >= passScore
    ).length;
    const avgScore =
      completedCount > 0
        ? Number(
            (
              leaderboard.reduce((sum, r) => sum + Number(r.score), 0) / completedCount
            ).toFixed(2)
          )
        : 0;
    const passRate =
      completedCount > 0 ? Math.round((passedCount / completedCount) * 100) : 0;

    return res.status(200).json({
      success: true,
      data: {
        exam,
        stats: {
          inProgressCount: inProgressRows.length,
          completedCount,
          avgScore,
          passRate,
        },
        leaderboard,
        inProgress: inProgressRows,
      },
    });
  } catch (error) {
    next(error);
  }
}
