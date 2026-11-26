import { pool } from "../config/db.js";
import { isId, isText, validateQuestion } from "../utils/validation.js";

export async function getSubjects(req, res, next) {
  try {
    const [rows] = await pool.query(`
      SELECT
        s.*,
        (SELECT COUNT(*) FROM questions q WHERE q.subject_id = s.id) AS question_count,
        (SELECT COUNT(*) FROM exams e WHERE e.subject_id = s.id) AS exam_count
      FROM subjects s
      ORDER BY s.id ASC
    `);

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
}

export async function createSubject(req, res, next) {
  try {
    const { code, name, description } = req.body;
    if (!isText(code, 30) || !isText(name, 150) || typeof (description ?? "") !== "string") {
      return res.status(400).json({
        success: false,
        message: "Mã môn học và tên môn học không được để trống.",
      });
    }

    const [existing] = await pool.query(
      "SELECT id FROM subjects WHERE code = ?",
      [code.trim().toUpperCase()]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Mã môn học này đã tồn tại.",
      });
    }

    const [result] = await pool.query(
      `INSERT INTO subjects (code, name, description, created_by) VALUES (?, ?, ?, ?)`,
      [code.trim().toUpperCase(), name.trim(), description || "", req.user.id]
    );

    return res.status(201).json({
      success: true,
      message: "Tạo môn học mới thành công!",
      data: {
        id: result.insertId,
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description || "",
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateSubject(req, res, next) {
  try {
    const { id } = req.params;
    const { code, name, description } = req.body;
    if (!isText(code, 30) || !isText(name, 150) || typeof (description ?? "") !== "string") {
      return res.status(400).json({
        success: false,
        message: "Mã môn học và tên môn học không được để trống.",
      });
    }

    const [used] = await pool.query(
      "SELECT sub.id FROM submissions sub JOIN exams e ON sub.exam_id = e.id WHERE e.subject_id = ? LIMIT 1", [id]
    );
    if (used.length) return res.status(409).json({ success: false, message: "Môn học đã có kết quả thi nên không thể sửa." });
    const [result] = await pool.query(
      `UPDATE subjects SET code = ?, name = ?, description = ? WHERE id = ?`,
      [code.trim().toUpperCase(), name.trim(), description || "", id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy môn học cần cập nhật.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Cập nhật môn học thành công!",
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteSubject(req, res, next) {
  try {
    const { id } = req.params;
    const [children] = await pool.query(
      "SELECT (SELECT COUNT(*) FROM questions WHERE subject_id = ?) + (SELECT COUNT(*) FROM exams WHERE subject_id = ?) AS total", [id, id]
    );
    if (Number(children[0].total) > 0) {
      return res.status(409).json({ success: false, message: "Chỉ xóa được môn học chưa có câu hỏi và đề thi." });
    }
    const [result] = await pool.query("DELETE FROM subjects WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy môn học cần xóa.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Đã xóa môn học thành công!",
    });
  } catch (error) {
    next(error);
  }
}

export async function getQuestions(req, res, next) {
  try {
    if (req.user?.role === "STUDENT") {
      return res.status(403).json({
        success: false,
        message: "Sinh viên không có quyền truy cập ngân hàng câu hỏi.",
      });
    }
    const { subjectId, difficulty, search } = req.query;
    let sql = `
      SELECT
        q.*,
        s.name AS subject_name,
        s.code AS subject_code,
        (SELECT COUNT(*) FROM exam_questions eq WHERE eq.question_id = q.id) AS exam_count,
        (SELECT COUNT(*) FROM submissions sub INNER JOIN exam_questions eq ON sub.exam_id = eq.exam_id WHERE eq.question_id = q.id) AS submission_count
      FROM questions q
      INNER JOIN subjects s ON q.subject_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (subjectId) {
      sql += " AND q.subject_id = ?";
      params.push(Number(subjectId));
    }
    if (difficulty) {
      sql += " AND q.difficulty = ?";
      params.push(difficulty);
    }
    if (search) {
      sql += " AND q.content LIKE ?";
      params.push(`%${search.trim()}%`);
    }

    sql += " ORDER BY q.id DESC";

    const [rows] = await pool.query(sql, params);
    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
}

export async function createQuestion(req, res, next) {
  try {
    const {
      subjectId,
      content,
      optionA,
      optionB,
      optionC,
      optionD,
      correctAnswer,
      difficulty = "MEDIUM",
      explanation = "",
    } = req.body;

    const message = validateQuestion(req.body);
    if (message) return res.status(400).json({ success: false, message });
    const [subjects] = await pool.query("SELECT id FROM subjects WHERE id = ?", [Number(subjectId)]);
    if (!subjects.length) return res.status(400).json({ success: false, message: "Môn học không tồn tại." });

    const [result] = await pool.query(
      `INSERT INTO questions
        (subject_id, content, option_a, option_b, option_c, option_d, correct_answer, difficulty, explanation, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(subjectId),
        content.trim(),
        optionA.trim(),
        optionB.trim(),
        optionC.trim(),
        optionD.trim(),
        correctAnswer,
        difficulty,
        explanation.trim(),
        req.user.id,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Thêm câu hỏi vào ngân hàng thành công!",
      data: { id: result.insertId },
    });
  } catch (error) {
    next(error);
  }
}

export async function bulkCreateQuestions(req, res, next) {
  let connection;
  try {
    const resolvedSubjectId = req.body.subject_id ?? req.body.subjectId;
    const { questions } = req.body;

    if (!isId(resolvedSubjectId)) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng chọn môn học hợp lệ.",
      });
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Danh sách câu hỏi không được để trống.",
      });
    }

    if (questions.length > 200) {
      return res.status(400).json({
        success: false,
        message: "Mỗi lần nhập nhanh chỉ hỗ trợ tối đa 200 câu hỏi.",
      });
    }

    const normalizedQuestions = [];
    for (let i = 0; i < questions.length; i++) {
      const item = questions[i] || {};
      const normalized = {
        subjectId: Number(resolvedSubjectId),
        content: item.content,
        optionA: item.optionA ?? item.option_a,
        optionB: item.optionB ?? item.option_b,
        optionC: item.optionC ?? item.option_c,
        optionD: item.optionD ?? item.option_d,
        correctAnswer: String(item.correctAnswer ?? item.correct_answer ?? "").trim().toUpperCase(),
        difficulty: item.difficulty || "MEDIUM",
        explanation: item.explanation ?? "",
      };

      const errMsg = validateQuestion(normalized);
      if (errMsg) {
        return res.status(400).json({
          success: false,
          message: `Câu hỏi thứ ${i + 1} không hợp lệ: ${errMsg}`,
        });
      }
      normalizedQuestions.push(normalized);
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [subjects] = await connection.query("SELECT id FROM subjects WHERE id = ?", [
      Number(resolvedSubjectId),
    ]);
    if (!subjects.length) {
      throw Object.assign(new Error("Môn học không tồn tại."), { statusCode: 400 });
    }

    const values = normalizedQuestions.map((q) => [
      q.subjectId,
      q.content.trim(),
      q.optionA.trim(),
      q.optionB.trim(),
      q.optionC.trim(),
      q.optionD.trim(),
      q.correctAnswer,
      q.difficulty,
      q.explanation.trim(),
      req.user.id,
    ]);

    const [result] = await connection.query(
      `INSERT INTO questions
        (subject_id, content, option_a, option_b, option_c, option_d, correct_answer, difficulty, explanation, created_by)
       VALUES ?`,
      [values]
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: `Đã nhập thành công ${result.affectedRows} câu hỏi vào ngân hàng!`,
      data: {
        insertedCount: result.affectedRows,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    if (connection) connection.release();
  }
}

export async function updateQuestion(req, res, next) {
  let connection;
  try {
    const { id } = req.params;
    const {
      subjectId,
      content,
      optionA,
      optionB,
      optionC,
      optionD,
      correctAnswer,
      difficulty = "MEDIUM",
      explanation = "",
    } = req.body;

    const message = validateQuestion(req.body);
    if (message) return res.status(400).json({ success: false, message });

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existingRows] = await connection.query(
      "SELECT id, subject_id FROM questions WHERE id = ? FOR UPDATE",
      [id]
    );
    if (!existingRows.length) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy câu hỏi cần cập nhật.",
      });
    }

    const [subjects] = await connection.query("SELECT id, code FROM subjects WHERE id = ?", [
      Number(subjectId),
    ]);
    if (!subjects.length) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Môn học không tồn tại." });
    }
    const subjectCode = subjects[0].code;

    const [examLinks] = await connection.query(
      "SELECT DISTINCT exam_id FROM exam_questions WHERE question_id = ?",
      [id]
    );
    const examIds = examLinks.map((row) => row.exam_id);

    if (examIds.length > 0 && Number(subjectId) !== Number(existingRows[0].subject_id)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Không thể đổi môn học của câu hỏi đang nằm trong đề thi.",
      });
    }

    await connection.query(
      `UPDATE questions
       SET subject_id = ?, content = ?, option_a = ?, option_b = ?, option_c = ?, option_d = ?,
           correct_answer = ?, difficulty = ?, explanation = ?
       WHERE id = ?`,
      [
        Number(subjectId),
        content.trim(),
        optionA.trim(),
        optionB.trim(),
        optionC.trim(),
        optionD.trim(),
        correctAnswer,
        difficulty,
        explanation.trim(),
        id,
      ]
    );

    let regradedSubmissionsCount = 0;
    for (const examId of examIds) {
      const [examQuestions] = await connection.query(
        `SELECT q.id, q.correct_answer
         FROM exam_questions eq
         INNER JOIN questions q ON eq.question_id = q.id
         WHERE eq.exam_id = ?`,
        [examId]
      );
      const totalQuestions = examQuestions.length;
      if (totalQuestions === 0) continue;

      const [submissions] = await connection.query(
        "SELECT id, is_suspended, answers_json FROM submissions WHERE exam_id = ? FOR UPDATE",
        [examId]
      );

      for (const sub of submissions) {
        if (Number(sub.is_suspended) === 1) {
          await connection.query(
            "UPDATE submissions SET score = 0, correct_count = 0, total_questions = ? WHERE id = ?",
            [totalQuestions, sub.id]
          );
          regradedSubmissionsCount++;
          continue;
        }
        const parsedAnswers =
          typeof sub.answers_json === "string"
            ? JSON.parse(sub.answers_json || "{}")
            : sub.answers_json || {};

        let correctCount = 0;
        for (const q of examQuestions) {
          const choice = parsedAnswers[q.id] || parsedAnswers[String(q.id)];
          if (choice && choice === q.correct_answer) {
            correctCount++;
          }
        }
        const score = Number(((correctCount / totalQuestions) * 10).toFixed(2));

        await connection.query(
          "UPDATE submissions SET score = ?, correct_count = ?, total_questions = ? WHERE id = ?",
          [score, correctCount, totalQuestions, sub.id]
        );
        regradedSubmissionsCount++;
      }
    }

    const syncedExamsCount = examIds.length;
    await connection.query(
      `INSERT INTO admin_logs (admin_id, admin_name, action_type, exam_title, subject_code, details)
       VALUES (?, ?, 'UPDATE_QUESTION_REGRADE', ?, ?, ?)`,
      [
        req.user?.id || null,
        req.user?.fullName || "Quản trị viên",
        content.trim().slice(0, 200),
        subjectCode,
        `Cập nhật câu hỏi #${id} — đồng bộ ${syncedExamsCount} đề thi, tính lại điểm ${regradedSubmissionsCount} bài nộp`,
      ]
    );

    await connection.commit();
    const responseMessage =
      regradedSubmissionsCount > 0
        ? `Cập nhật câu hỏi thành công! Đã đồng bộ ${syncedExamsCount} đề thi và tính lại điểm cho ${regradedSubmissionsCount} bài nộp.`
        : syncedExamsCount > 0
        ? `Cập nhật câu hỏi thành công! Đã đồng bộ vào ${syncedExamsCount} đề thi.`
        : "Cập nhật câu hỏi thành công!";

    return res.status(200).json({
      success: true,
      message: responseMessage,
      data: {
        syncedExamsCount,
        regradedSubmissionsCount,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    if (connection) connection.release();
  }
}

export async function deleteQuestion(req, res, next) {
  try {
    const { id } = req.params;
    const [linked] = await pool.query("SELECT id FROM exam_questions WHERE question_id = ? LIMIT 1", [id]);
    if (linked.length) {
      return res.status(409).json({ success: false, message: "Câu hỏi đang thuộc đề thi nên không thể sửa/xóa. Hãy tạo câu hỏi mới hoặc gỡ khỏi đề chưa có bài nộp." });
    }
    const [result] = await pool.query("DELETE FROM questions WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy câu hỏi cần xóa.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Đã xóa câu hỏi khỏi ngân hàng!",
    });
  } catch (error) {
    next(error);
  }
}
