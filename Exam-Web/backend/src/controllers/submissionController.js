import { pool } from "../config/db.js";
import { isId, isNumber } from "../utils/validation.js";

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

    if (!answers || typeof answers !== "object" || Array.isArray(answers) ||
        !Object.values(answers).every((answer) => ["A", "B", "C", "D"].includes(answer))) {
      return res.status(400).json({ success: false, message: "Danh sách đáp án không hợp lệ." });
    }
    const [exams] = await pool.query(
      "SELECT id, is_published, duration_minutes, major_group, open_at, close_at, max_attempts FROM exams WHERE id = ?",
      [Number(examId)]
    );
    if (!exams.length) return res.status(404).json({ success: false, message: "Không tìm thấy đề thi." });
    if (req.user.role === "STUDENT") {
      if (!exams[0].is_published) {
        return res.status(403).json({ success: false, message: "Đề thi này chưa được mở." });
      }
      const now = new Date();
      if (exams[0].open_at && now < new Date(exams[0].open_at)) {
        return res.status(403).json({ success: false, message: "Đề thi chưa đến thời gian mở." });
      }
      if (exams[0].close_at && now.getTime() > new Date(exams[0].close_at).getTime() + 60000) {
        return res.status(403).json({ success: false, message: "Đề thi đã hết thời gian đóng." });
      }
      if (exams[0].max_attempts !== null && exams[0].max_attempts !== undefined) {
        const [attemptRows] = await pool.query(
          "SELECT COUNT(*) AS cnt FROM submissions WHERE exam_id = ? AND student_id = ?",
          [Number(examId), req.user.id]
        );
        if (Number(attemptRows[0].cnt) >= Number(exams[0].max_attempts)) {
          return res.status(403).json({
            success: false,
            message: `Bạn đã hết lượt làm bài (${exams[0].max_attempts} lượt) cho đề thi này.`,
          });
        }
      }
      if (exams[0].major_group && exams[0].major_group !== "ALL") {
        let studentMajor = req.user.majorGroup;
        if (!studentMajor) {
          const [uRows] = await pool.query("SELECT major_group FROM users WHERE id = ?", [req.user.id]);
          studentMajor = uRows[0]?.major_group || null;
        }
        if (exams[0].major_group !== studentMajor) {
          return res.status(403).json({
            success: false,
            message: "Đề thi này không thuộc khối ngành của bạn.",
          });
        }
      }
    }
    if (!isNumber(timeSpentSeconds) || !Number.isInteger(Number(timeSpentSeconds)) || Number(timeSpentSeconds) < 0 || Number(timeSpentSeconds) > exams[0].duration_minutes * 60) {
      return res.status(400).json({ success: false, message: "Thời gian làm bài không hợp lệ." });
    }

    const [questions] = await pool.query(
      `
      SELECT q.id, q.correct_answer
      FROM exam_questions eq
      INNER JOIN questions q ON eq.question_id = q.id
      WHERE eq.exam_id = ?
      `,
      [Number(examId)]
    );

    if (questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Đề thi chưa có câu hỏi nào để chấm điểm.",
      });
    }

    const questionIds = new Set(questions.map((q) => String(q.id)));
    if (Object.keys(answers).some((id) => !questionIds.has(id))) {
      return res.status(400).json({ success: false, message: "Có đáp án cho câu hỏi không thuộc đề thi." });
    }

    let correctCount = 0;
    const totalQuestions = questions.length;

    for (const q of questions) {
      const studentChoice = answers[q.id] || answers[String(q.id)];
      if (studentChoice && studentChoice === q.correct_answer) {
        correctCount++;
      }
    }

    const score = Number(((correctCount / totalQuestions) * 10).toFixed(2));
    const maxDurationSec = Number(exams[0].duration_minutes) * 60;
    let safeTimeSpent = Number(timeSpentSeconds) || 0;
    const rawStartedAt = started_at ?? startedAt;
    let resolvedStartedAt = null;

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [attemptRows] = await connection.query(
      `SELECT started_at, status, is_suspended, suspend_reason FROM exam_attempts
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

    if (req.user.role === "STUDENT" && exams[0].max_attempts !== null && exams[0].max_attempts !== undefined) {
      const [attemptCountRows] = await connection.query(
        "SELECT COUNT(*) AS cnt FROM submissions WHERE exam_id = ? AND student_id = ?",
        [Number(examId), req.user.id]
      );
      if (Number(attemptCountRows[0].cnt) >= Number(exams[0].max_attempts)) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: `Bạn đã hết lượt làm bài (${exams[0].max_attempts} lượt) cho đề thi này.`,
        });
      }
    }

    if (
      attemptRows.length > 0 &&
      attemptRows[0].status === "IN_PROGRESS" &&
      attemptRows[0].started_at
    ) {
      const serverStarted = new Date(attemptRows[0].started_at);
      if (!Number.isNaN(serverStarted.getTime())) {
        resolvedStartedAt = serverStarted;
        const actualTimeSpent = Math.max(
          0,
          Math.round((Date.now() - serverStarted.getTime()) / 1000)
        );
        safeTimeSpent = Math.min(maxDurationSec, Math.max(safeTimeSpent, actualTimeSpent));
      }
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

    const [result] = await connection.query(
      `INSERT INTO submissions
        (exam_id, student_id, score, correct_count, total_questions, time_spent_seconds, started_at, tab_switch_count, answers_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(examId),
        req.user.id,
        score,
        correctCount,
        totalQuestions,
        safeTimeSpent,
        resolvedStartedAt,
        safeTabSwitchCount,
        JSON.stringify(answers),
      ]
    );

    await connection.query(
      `INSERT INTO exam_attempts (exam_id, user_id, started_at, status)
       VALUES (?, ?, ?, 'COMPLETED')
       ON DUPLICATE KEY UPDATE status = 'COMPLETED'`,
      [Number(examId), req.user.id, resolvedStartedAt]
    );

    await connection.commit();

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
        sub.*,
        e.title AS exam_title,
        e.duration_minutes,
        e.pass_score,
        e.subject_id,
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

    return res.status(200).json({
      success: true,
      data: rows,
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
        e.duration_minutes,
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

    const parsedAnswers =
      typeof submission.answers_json === "string"
        ? JSON.parse(submission.answers_json || "{}")
        : submission.answers_json || {};

    const detailedQuestions = questions.map((q) => {
      const selectedOption = parsedAnswers[q.id] || parsedAnswers[String(q.id)] || null;
      return {
        ...q,
        selected_option: selectedOption,
        is_correct: selectedOption === q.correct_answer,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        ...submission,
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
    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteSubmission(req, res, next) {
  try {
    const { id } = req.params;
    const [infoRows] = await pool.query(
      `SELECT sub.id, sub.score, e.title AS exam_title, s.code AS subject_code,
              u.full_name AS student_name, u.student_code
       FROM submissions sub
       LEFT JOIN exams e ON sub.exam_id = e.id
       LEFT JOIN subjects s ON e.subject_id = s.id
       LEFT JOIN users u ON sub.student_id = u.id
       WHERE sub.id = ?`,
      [id]
    );

    const [result] = await pool.query("DELETE FROM submissions WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy bản ghi kết quả cần xóa.",
      });
    }

    if (infoRows.length > 0) {
      const info = infoRows[0];
      await pool.query(
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

    return res.status(200).json({
      success: true,
      message: "Đã xóa kết quả thi thành công!",
    });
  } catch (error) {
    next(error);
  }
}

export async function suspendSubmission(req, res, next) {
  let connection;
  try {
    const { examId, userId, reason } = req.body;
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
      `SELECT e.id, e.title, s.code AS subject_code,
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
      "SELECT started_at FROM exam_attempts WHERE exam_id = ? AND user_id = ? FOR UPDATE",
      [Number(examId), Number(userId)]
    );
    const attemptStartedAt = attemptRows[0]?.started_at || new Date();

    await connection.query(
      `INSERT INTO exam_attempts (exam_id, user_id, started_at, status, is_suspended, suspend_reason)
       VALUES (?, ?, ?, 'COMPLETED', 1, ?)
       ON DUPLICATE KEY UPDATE
         status = 'COMPLETED',
         is_suspended = 1,
         suspend_reason = VALUES(suspend_reason)`,
      [Number(examId), Number(userId), attemptStartedAt, cleanReason]
    );

    const [existingSub] = await connection.query(
      "SELECT id FROM submissions WHERE exam_id = ? AND student_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE",
      [Number(examId), Number(userId)]
    );

    if (existingSub.length > 0) {
      await connection.query(
        `UPDATE submissions
         SET score = 0, correct_count = 0, is_suspended = 1, suspend_reason = ?, submitted_at = NOW()
         WHERE id = ?`,
        [cleanReason, existingSub[0].id]
      );
    } else {
      await connection.query(
        `INSERT INTO submissions
          (exam_id, student_id, score, correct_count, total_questions, time_spent_seconds, started_at, tab_switch_count, is_suspended, suspend_reason, answers_json)
         VALUES (?, ?, 0, 0, ?, 0, ?, 0, 1, ?, '{}')`,
        [
          Number(examId),
          Number(userId),
          Number(exam.total_questions) || 0,
          attemptStartedAt,
          cleanReason,
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
    const { examId, userId } = req.body;
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

    await connection.query(
      "DELETE FROM submissions WHERE exam_id = ? AND student_id = ?",
      [Number(examId), Number(userId)]
    );
    await connection.query(
      "DELETE FROM exam_attempts WHERE exam_id = ? AND user_id = ?",
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
