import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/config/db.js";
import { recordViolationWithLog } from "../src/services/proctorService.js";
import { submitExam, recordExamViolation } from "../src/controllers/submissionController.js";
import { getExamById } from "../src/controllers/examController.js";

function createMockRes() {
  const state = { statusCode: 200, body: null };
  return {
    state,
    status(code) {
      state.statusCode = code;
      return this;
    },
    json(payload) {
      state.body = payload;
      return this;
    },
  };
}

test("recordViolationWithLog: từ chối khi chưa có exam_attempts và tuyệt đối không INSERT exam_attempts", async (t) => {
  const executedSqls = [];
  let rolledBack = false;
  let released = false;

  const fakeConn = {
    async beginTransaction() {},
    async rollback() {
      rolledBack = true;
    },
    async commit() {
      assert.fail("Không được commit khi chưa có lượt thi IN_PROGRESS");
    },
    release() {
      released = true;
    },
    async query(sql) {
      executedSqls.push(String(sql));
      if (sql.includes("FROM exams")) {
        return [[{ id: 10, duration_minutes: 30, max_tab_switches: 3, anti_cheat: 1, close_at: null }]];
      }
      if (sql.includes("FROM exam_attempts")) {
        return [[]];
      }
      assert.fail(`Không được thực thi truy vấn phát sinh: ${sql}`);
    },
  };

  t.mock.method(pool, "getConnection", async () => fakeConn);

  const result = await recordViolationWithLog({
    examId: 10,
    userId: 99,
    reason: "Rời tab",
    unfocusedSeconds: 12,
    answers: { 1: "A" },
  });

  assert.equal(result.noActiveAttempt, true);
  assert.equal(result.violationLog, null);
  assert.equal(rolledBack, true);
  assert.equal(released, true);
  assert.equal(
    executedSqls.some((s) => /INSERT\s+INTO\s+exam_attempts/i.test(s)),
    false
  );
  assert.equal(
    executedSqls.some((s) => /INSERT\s+INTO\s+exam_violation_logs/i.test(s)),
    false
  );

  // Kiểm tra qua controller HTTP trả về 403 Forbidden
  const res = createMockRes();
  await recordExamViolation(
    { params: { id: "10" }, user: { id: 99, role: "STUDENT" }, body: { reason: "Rời tab" } },
    res,
    (err) => assert.ifError(err)
  );
  assert.equal(res.state.statusCode, 403);
  assert.equal(res.state.body.success, false);
});

test("recordViolationWithLog: từ chối khi exam_attempts ở trạng thái COMPLETED (không ghi đè unfocused/tab_switch/log)", async (t) => {
  const executedSqls = [];
  let rolledBack = false;

  const fakeConn = {
    async beginTransaction() {},
    async rollback() {
      rolledBack = true;
    },
    async commit() {
      assert.fail("Không được commit khi lượt thi đã COMPLETED");
    },
    release() {},
    async query(sql) {
      executedSqls.push(String(sql));
      if (sql.includes("FROM exams")) {
        return [[{ id: 10, duration_minutes: 30, max_tab_switches: 3, anti_cheat: 1, close_at: null }]];
      }
      if (sql.includes("FROM exam_attempts")) {
        return [[{
          started_at: new Date(Date.now() - 600_000),
          elapsed_seconds: 600,
          status: "COMPLETED",
          is_suspended: 0,
          suspend_reason: null,
          tab_switch_count: 1,
          unfocused_seconds: 5,
          draft_answers_json: null,
          attempt_blueprint_json: null,
        }]];
      }
      assert.fail(`Không được thực thi truy vấn phát sinh: ${sql}`);
    },
  };

  t.mock.method(pool, "getConnection", async () => fakeConn);

  const result = await recordViolationWithLog({
    examId: 10,
    userId: 99,
    reason: "Rời tab sau khi nộp",
    unfocusedSeconds: 50,
  });

  assert.equal(result.noActiveAttempt, true);
  assert.equal(result.violationLog, null);
  assert.equal(rolledBack, true);
  assert.equal(
    executedSqls.some((s) => /UPDATE\s+exam_attempts|INSERT\s+INTO\s+exam_violation_logs/i.test(s)),
    false
  );
});

test("recordViolationWithLog: ghi nhận bình thường khi sinh viên có exam_attempts IN_PROGRESS hợp lệ", async (t) => {
  const executedSqls = [];
  let committed = false;
  const startedAt = new Date(Date.now() - 30_000);
  const futureCloseAt = new Date(Date.now() + 600_000);

  const fakeConn = {
    async beginTransaction() {},
    async rollback() {
      assert.fail("Không được rollback ở luồng IN_PROGRESS hợp lệ");
    },
    async commit() {
      committed = true;
    },
    release() {},
    async query(sql) {
      executedSqls.push(String(sql));
      if (sql.includes("FROM exams")) {
        return [[{ id: 10, duration_minutes: 30, max_tab_switches: 3, anti_cheat: 1, close_at: futureCloseAt }]];
      }
      if (sql.includes("FOR UPDATE")) {
        return [[{
          started_at: startedAt,
          elapsed_seconds: 30,
          status: "IN_PROGRESS",
          is_suspended: 0,
          suspend_reason: null,
          tab_switch_count: 0,
          unfocused_seconds: 2,
          draft_answers_json: null,
          attempt_blueprint_json: JSON.stringify({ version: 1, items: [{ questionId: 101, optionOrder: ["A", "B", "C", "D"] }] }),
        }]];
      }
      if (sql.includes("INSERT INTO exam_violation_logs")) {
        return [{ insertId: 555 }];
      }
      if (sql.includes("SELECT COUNT(*) AS cnt") && sql.includes("FROM exam_violation_logs")) {
        return [[{ cnt: 1 }]];
      }
      if (sql.includes("UPDATE exam_attempts")) {
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("WHERE vl.id = ?")) {
        return [[{ id: 555, exam_id: 10, user_id: 99, reason: "Rời tab", status: "PENDING" }]];
      }
      if (sql.includes("FROM users u")) {
        return [[{
          user_id: 99,
          full_name: "SV Test",
          student_code: "B22DCCN001",
          major_group: "KY_THUAT",
          attempt_id: 1,
          started_at: startedAt,
          attempt_status: "IN_PROGRESS",
          attempt_suspended: 0,
          attempt_tab_switches: 1,
          attempt_unfocused_seconds: 8,
          is_unfocused: 1,
          submission_id: null,
        }]];
      }
      if (sql.includes("SUM(CASE WHEN status = 'PENDING'")) {
        return [[{ pending_cnt: 1, confirmed_cnt: 0, dismissed_cnt: 0 }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  t.mock.method(pool, "getConnection", async () => fakeConn);

  const result = await recordViolationWithLog({
    examId: 10,
    userId: 99,
    reason: "Rời tab",
    unfocusedSeconds: 8,
    answers: { 101: "B" },
  });

  assert.equal(committed, true);
  assert.equal(result.tabSwitchCount, 1);
  assert.equal(result.violationLog?.id, 555);
  assert.equal(
    executedSqls.some((s) => /INSERT\s+INTO\s+exam_attempts/i.test(s)),
    false
  );
});

test("submitExam: từ chối 403 ngay lập tức khi serverStarted > close_at (kể cả trong 15s ân hạn mạng, không dùng Math.max(1,...))", async (t) => {
  const nowMs = Date.now();
  const closeAt = new Date(nowMs - 3_000); // Đề vừa đóng 3 giây trước (vẫn trong 15s grace nếu tính Date.now())
  const startedAfterClose = new Date(nowMs - 1_000); // Nhưng lượt thi lại bắt đầu SAU close_at 2 giây!
  let rolledBack = false;

  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM exams")) {
      return [[{
        id: 20,
        is_published: 1,
        duration_minutes: 30,
        major_group: "ALL",
        open_at: null,
        close_at: closeAt,
        max_attempts: null,
        anti_cheat: 1,
        max_tab_switches: 3,
      }]];
    }
    throw new Error(`Unexpected pool.query: ${sql}`);
  });

  const fakeConn = {
    async beginTransaction() {},
    async rollback() {
      rolledBack = true;
    },
    async commit() {
      assert.fail("Không được commit khi serverStarted > close_at");
    },
    release() {},
    async query(sql) {
      if (sql.includes("FROM exam_attempts")) {
        return [[{
          started_at: startedAfterClose,
          elapsed_seconds: 1,
          seconds_since_last_violation: null,
          status: "IN_PROGRESS",
          is_suspended: 0,
          suspend_reason: null,
          tab_switch_count: 0,
          unfocused_seconds: 0,
          draft_answers_json: JSON.stringify({ 1: "A" }),
          attempt_blueprint_json: null,
        }]];
      }
      assert.fail(`Không được chấm điểm hoặc INSERT submissions khi serverStarted > close_at: ${sql}`);
    },
  };
  t.mock.method(pool, "getConnection", async () => fakeConn);

  const res = createMockRes();
  await submitExam(
    {
      user: { id: 99, role: "STUDENT", majorGroup: "KY_THUAT" },
      body: { examId: 20, answers: { 1: "A" }, timeSpentSeconds: 1 },
    },
    res,
    (err) => assert.ifError(err)
  );

  assert.equal(rolledBack, true);
  assert.equal(res.state.statusCode, 403);
  assert.equal(res.state.body.success, false);
  assert.match(res.state.body.message, /đã đóng/i);
});

test("submitExam: từ chối 403 ngay lập tức khi Date.now() > close_at + NETWORK_GRACE_SECONDS * 1000 (không tự chốt điểm nháp)", async (t) => {
  const nowMs = Date.now();
  const closeAt = new Date(nowMs - 20_000); // Đã quá close_at 20s (> 15s grace)
  const startedBeforeClose = new Date(nowMs - 300_000); // Bắt đầu hợp lệ trước khi đóng 5 phút
  let rolledBack = false;

  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM exams")) {
      return [[{
        id: 21,
        is_published: 1,
        duration_minutes: 30,
        major_group: "ALL",
        open_at: null,
        close_at: closeAt,
        max_attempts: null,
        anti_cheat: 1,
        max_tab_switches: 3,
      }]];
    }
    throw new Error(`Unexpected pool.query: ${sql}`);
  });

  const fakeConn = {
    async beginTransaction() {},
    async rollback() {
      rolledBack = true;
    },
    async commit() {
      assert.fail("Không được commit khi nộp quá close_at + 15s");
    },
    release() {},
    async query(sql) {
      if (sql.includes("FROM exam_attempts")) {
        return [[{
          started_at: startedBeforeClose,
          elapsed_seconds: 300,
          seconds_since_last_violation: null,
          status: "IN_PROGRESS",
          is_suspended: 0,
          suspend_reason: null,
          tab_switch_count: 0,
          unfocused_seconds: 0,
          draft_answers_json: JSON.stringify({ 1: "A" }),
          attempt_blueprint_json: null,
        }]];
      }
      assert.fail(`Không được chấm điểm hoặc INSERT submissions khi quá hạn đóng đề: ${sql}`);
    },
  };
  t.mock.method(pool, "getConnection", async () => fakeConn);

  const res = createMockRes();
  await submitExam(
    {
      user: { id: 99, role: "STUDENT", majorGroup: "KY_THUAT" },
      body: { examId: 21, answers: { 1: "A" }, timeSpentSeconds: 280 },
    },
    res,
    (err) => assert.ifError(err)
  );

  assert.equal(rolledBack, true);
  assert.equal(res.state.statusCode, 403);
  assert.equal(res.state.body.success, false);
  assert.match(res.state.body.message, /đã đóng/i);
});

test("submitExam: cho phép nộp bài và chấm điểm bình thường khi bắt đầu trước close_at và nộp trong thời gian hợp lệ", async (t) => {
  const nowMs = Date.now();
  const startedBeforeClose = new Date(nowMs - 60_000);
  const closeAt = new Date(nowMs - 5_000); // Vừa đóng 5s trước (nằm trong 15s ân hạn mạng hợp lệ cho luồng auto-submit)
  let committed = false;

  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM exams")) {
      return [[{
        id: 22,
        is_published: 1,
        duration_minutes: 30,
        major_group: "ALL",
        open_at: null,
        close_at: closeAt,
        max_attempts: null,
        anti_cheat: 0,
        max_tab_switches: null,
      }]];
    }
    throw new Error(`Unexpected pool.query: ${sql}`);
  });

  const fakeConn = {
    async beginTransaction() {},
    async rollback() {
      assert.fail("Không được rollback ở luồng nộp bài hợp lệ");
    },
    async commit() {
      committed = true;
    },
    release() {},
    async query(sql) {
      if (sql.includes("FROM exam_attempts") && sql.includes("FOR UPDATE")) {
        return [[{
          started_at: startedBeforeClose,
          elapsed_seconds: 60, // closeLimitSec = 55s, effectiveAllowedSec = 55s, 60 <= 55 + 15
          seconds_since_last_violation: null,
          status: "IN_PROGRESS",
          is_suspended: 0,
          suspend_reason: null,
          tab_switch_count: 0,
          unfocused_seconds: 0,
          draft_answers_json: null,
          attempt_blueprint_json: null,
        }]];
      }
      if (sql.includes("FROM exam_questions")) {
        return [[{ id: 1, correct_answer: "A" }]];
      }
      if (sql.includes("FROM exam_violation_logs")) {
        return [[{ total_logs: 0, valid_logs: 0 }]];
      }
      if (sql.includes("INSERT INTO submissions")) {
        return [{ insertId: 777 }];
      }
      if (sql.includes("UPDATE exam_attempts")) {
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected conn.query: ${sql}`);
    },
  };
  t.mock.method(pool, "getConnection", async () => fakeConn);

  const res = createMockRes();
  await submitExam(
    {
      user: { id: 99, role: "STUDENT", majorGroup: "KY_THUAT" },
      body: { examId: 22, answers: { 1: "A" }, timeSpentSeconds: 55 },
    },
    res,
    (err) => assert.ifError(err)
  );

  assert.equal(committed, true);
  assert.equal(res.state.statusCode, 201);
  assert.equal(res.state.body.data.score, 10);
});

test("startExam (getExamById): chặn vào thi sau close_at (403) và khởi tạo exam_attempts hợp lệ khi đề đang mở", async (t) => {
  const pastCloseAt = new Date(Date.now() - 10_000);
  const executedClosedSqls = [];

  t.mock.method(pool, "query", async (sql) => {
    executedClosedSqls.push(String(sql));
    if (sql.includes("FROM exams e")) {
      return [[{
        id: 30,
        subject_id: 1,
        title: "Đề đã đóng",
        duration_minutes: 30,
        pass_score: 5,
        is_published: 1,
        major_group: "ALL",
        open_at: null,
        close_at: pastCloseAt,
        anti_cheat: 1,
        max_tab_switches: 3,
        max_attempts: null,
      }]];
    }
    assert.fail(`Không được tạo exam_attempts khi đề đã quá close_at: ${sql}`);
  });

  const closedRes = createMockRes();
  await getExamById(
    { params: { id: "30" }, query: { mode: "take" }, user: { id: 99, role: "STUDENT", majorGroup: "KY_THUAT" } },
    closedRes,
    (err) => assert.ifError(err)
  );
  assert.equal(closedRes.state.statusCode, 403);
  assert.equal(
    executedClosedSqls.some((s) => /INSERT\s+INTO\s+exam_attempts/i.test(s)),
    false
  );
});

