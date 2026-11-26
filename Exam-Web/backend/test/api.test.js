import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import "dotenv/config";
import { io as createClientSocket } from "../../frontend/node_modules/socket.io-client/build/esm/index.js";

// Database tạm, không dùng hoặc xóa dữ liệu của ứng dụng.
const testDatabase = `ptit_exam_test_${Date.now()}_${process.pid}`;
process.env.DB_NAME = testDatabase;
process.env.JWT_SECRET = "test_secret_only_for_local_integration_tests";
process.env.ADMIN_EMAIL = "admin.test@ptit.edu.vn";
process.env.ADMIN_PASSWORD = "AdminTestPassword123!";
const { pool, initializeDatabase } = await import("../src/config/db.js");
const { setMailSenderForTests, setEmailVerifierForTests } = await import("../src/utils/mailer.js");
const { default: routes } = await import("../src/routes/apiRoutes.js");
const { errorHandler } = await import("../src/middlewares/errorMiddleware.js");
const { attachProctorSocketServer } = await import("../src/socket/proctorSocket.js");
const sentOtps = new Map();
setMailSenderForTests(async ({ to, otp }) => {
  sentOtps.set(to, otp);
});
setEmailVerifierForTests(async (email) => !email.startsWith("khongtontai."));
let server;
let ioServer;
let socketUrl;
let baseUrl;
let teacherToken;
let teacherCookie;
let studentToken;
let subjectId;
let questionId;
let examId;
let studentAttemptAnswerKey = "A";

function findOptionKeyByText(questionObj, targetText) {
  for (const key of ["A", "B", "C", "D"]) {
    if (questionObj[`option_${key.toLowerCase()}`] === targetText) {
      return key;
    }
  }
  return null;
}

async function request(path, { method = "GET", token, cookie, body } = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}

const examForm = () => ({ subjectId, title: "Đề kiểm thử", description: "", durationMinutes: 5, passScore: 0, isPublished: 0, questionIds: [questionId] });

before(async () => {
  await initializeDatabase();
  const app = express();
  app.use(express.json());
  app.use("/api", routes);
  app.use(errorHandler);
  server = http.createServer(app);
  ioServer = attachProctorSocketServer(
    server,
    new Set(["http://localhost:5173", "https://ptit-exampro.vercel.app"])
  );
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  socketUrl = `http://127.0.0.1:${server.address().port}`;
  baseUrl = `${socketUrl}/api`;
  const adminStep1 = await request("/auth/login", {
    method: "POST",
    body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  });
  assert.equal(adminStep1.status, 200);
  assert.equal(adminStep1.body.data.requiresOtp, true);
  assert.equal(adminStep1.body.data.token, undefined);
  const challengeToken = adminStep1.body.data.challengeToken;
  assert.equal((await request("/questions", { token: challengeToken })).status, 401);
  assert.equal(
    (await request("/auth/login/verify-otp", { method: "POST", body: { challengeToken, otp: "000000" } })).status,
    400
  );
  const adminOtp = sentOtps.get(process.env.ADMIN_EMAIL);
  assert.match(adminOtp, /^\d{6}$/);
  const adminStep2 = await request("/auth/login/verify-otp", {
    method: "POST",
    body: { challengeToken, otp: adminOtp },
  });
  assert.equal(adminStep2.status, 200);
  teacherToken = adminStep2.body.data.token;
  teacherCookie = (adminStep2.headers.get("set-cookie") || "").split(";")[0];

  const studentRes = await request("/auth/login", {
    method: "POST",
    body: { email: "student@ptit.edu.vn", password: "123456" },
  });
  assert.equal(studentRes.status, 200);
  studentToken = studentRes.body.data.token;
});

after(async () => {
  if (ioServer) await new Promise((resolve) => ioServer.close(() => resolve()));
  else if (server) await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  try {
    if (!/^ptit_exam_test_\d+_\d+$/.test(testDatabase)) throw new Error("Tên database kiểm thử không hợp lệ.");
    await pool.query(`DROP DATABASE IF EXISTS \`${testDatabase}\``);
  } finally {
    await pool.end();
  }
});

test("Chưa đăng nhập nhận 401; sinh viên không được quản lý câu hỏi", async () => {
  assert.equal((await request("/exams")).status, 401);
  assert.equal((await request("/questions", { token: studentToken })).status, 403);
  assert.equal((await request("/chat", { method: "POST", body: { messages: [{ role: "user", content: "Chào" }] } })).status, 401);
  // Body sai được chặn trước khi gọi nhà cung cấp, không dùng key thật trong test.
  assert.equal((await request("/chat", { method: "POST", token: studentToken, body: { messages: [] } })).status, 400);
});

test("Đăng ký bắt buộc email @stu.ptit.edu.vn, tự tách MSV & khối ngành, xác thực OTP và chặn trùng MSV", async () => {
  // Sai đuôi email hoặc sai mã ngành -> 400
  assert.equal(
    (await request("/auth/register/send-otp", {
      method: "POST",
      body: { fullName: "Sai đuôi", email: "new@gmail.com", password: "TestPass123" },
    })).status,
    400
  );
  assert.equal(
    (await request("/auth/register/send-otp", {
      method: "POST",
      body: { fullName: "Sai mã ngành", email: "DucPA.B25ZZ302@stu.ptit.edu.vn", password: "TestPass123" },
    })).status,
    400
  );

  // Email đúng chuẩn nhưng hộp thư không tồn tại -> 400
  const fakeRes = await request("/auth/register/send-otp", {
    method: "POST",
    body: { fullName: "Mail ảo", email: "khongtontai.B25CN999@stu.ptit.edu.vn", password: "TestPass123" },
  });
  assert.equal(fakeRes.status, 400);
  assert.equal(fakeRes.body.message, "Email không tồn tại.");

  // Đăng ký sinh viên Khối Kỹ thuật (CC -> B25DCCC302 -> KY_THUAT)
  const payload = {
    fullName: "Phạm Anh Đức",
    email: "DucPA.B25CC302@stu.ptit.edu.vn",
    password: "TestPass123",
    role: "TEACHER",
    studentCode: "FAKE999",
    majorGroup: "KINH_TE",
  };
  assert.equal((await request("/auth/register", { method: "POST", body: payload })).status, 400);
  const otpRes = await request("/auth/register/send-otp", { method: "POST", body: payload });
  assert.equal(otpRes.status, 200);
  assert.equal(otpRes.body.data.studentId, "B25DCCC302");
  assert.equal(otpRes.body.data.majorGroup, "KY_THUAT");
  const realOtp = sentOtps.get("ducpa.b25cc302@stu.ptit.edu.vn");
  assert.match(realOtp, /^\d{6}$/);
  assert.equal((await request("/auth/register/send-otp", { method: "POST", body: payload })).status, 429);
  assert.equal((await request("/auth/register", { method: "POST", body: { ...payload, otp: "000000" } })).status, 400);
  const result = await request("/auth/register", { method: "POST", body: { ...payload, otp: realOtp } });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.user.role, "STUDENT");
  assert.equal(result.body.data.user.studentCode, "B25DCCC302");
  assert.equal(result.body.data.user.majorGroup, "KY_THUAT");
  assert.equal((await request("/questions", { token: result.body.data.token })).status, 403);

  // Trùng email đã đăng ký -> 409
  const usedEmailRes = await request("/auth/register/send-otp", {
    method: "POST",
    body: { fullName: "Trùng mail", email: "DucPA.B25CC302@stu.ptit.edu.vn", password: "TestPass123" },
  });
  assert.equal(usedEmailRes.status, 409);
  assert.equal(usedEmailRes.body.message, "Email này đã được sử dụng.");

  // Khác tên viết tắt nhưng trùng mã sinh viên B25CC302 (B25DCCC302) -> 409
  const usedCodeRes = await request("/auth/register/send-otp", {
    method: "POST",
    body: { fullName: "Trùng MSV", email: "KhacTen.B25CC302@stu.ptit.edu.vn", password: "TestPass123" },
  });
  assert.equal(usedCodeRes.status, 409);

  assert.equal((await request("/auth/register/send-otp", { method: "POST", body: { fullName: "  ", email: 123, password: "TestPass123" } })).status, 400);
  assert.equal((await request("/auth/register", { method: "POST", body: { fullName: "  ", email: 123, password: "TestPass123", otp: "123456" } })).status, 400);
  assert.equal((await request("/auth/login", { method: "POST", body: { email: {}, password: "TestPass123" } })).status, 400);
});

test("Tạo môn và câu hỏi; từ chối đáp án sai định dạng", async () => {
  let result = await request("/subjects", { method: "POST", token: teacherToken, body: { code: "TEST101", name: "Môn kiểm thử" } });
  assert.equal(result.status, 201);
  subjectId = result.body.data.id;
  const form = { subjectId, content: "Chọn A", optionA: "A", optionB: "B", optionC: "C", optionD: "D", correctAnswer: "A", difficulty: "EASY" };
  assert.equal((await request("/questions", { method: "POST", token: teacherToken, body: { ...form, correctAnswer: "X" } })).status, 400);
  result = await request("/questions", { method: "POST", token: teacherToken, body: form });
  assert.equal(result.status, 201);
  questionId = result.body.data.id;
});

test("Kiểm tra thời lượng, điểm đạt, câu trùng, câu sai môn và không lưu đề lỗi", async () => {
  for (const change of [{ durationMinutes: -1 }, { durationMinutes: 2.5 }, { durationMinutes: [5] }, { passScore: 11 }, { passScore: [] }, { description: null }, { questionIds: [] }, { questionIds: [questionId, questionId] }, { questionIds: [1] }]) {
    const result = await request("/exams", { method: "POST", token: teacherToken, body: { ...examForm(), ...change } });
    assert.equal(result.status, 400, JSON.stringify(change));
  }
  const [rows] = await pool.query("SELECT id FROM exams WHERE subject_id = ?", [subjectId]);
  assert.equal(rows.length, 0);
  const result = await request("/exams", { method: "POST", token: teacherToken, body: examForm() });
  assert.equal(result.status, 201);
  examId = result.body.data.id;
});

test("Sinh viên không thể liệt kê, xem hay nộp đề nháp", async () => {
  const list = await request("/exams", { token: studentToken });
  assert.equal(list.body.data.some((exam) => exam.id === examId), false);
  assert.equal((await request(`/exams/${examId}`, { token: studentToken })).status, 403);
  assert.equal((await request("/submissions", { method: "POST", token: studentToken, body: { examId } })).status, 403);
});

test("Sửa đề hợp lệ; lọc đề theo khối ngành (KY_THUAT / KINH_TE / ALL); cập nhật sai giữ nguyên danh sách câu hỏi", async () => {
  // Đổi đề sang riêng Khối Kinh tế (KINH_TE) -> sinh viên Khối Kỹ thuật không thấy và không vào thi được
  assert.equal(
    (await request(`/exams/${examId}`, {
      method: "PUT",
      token: teacherToken,
      body: { ...examForm(), isPublished: 1, majorGroup: "KINH_TE" },
    })).status,
    200
  );
  const techList = await request("/exams", { token: studentToken });
  assert.equal(techList.body.data.some((exam) => exam.id === examId), false);
  assert.equal((await request(`/exams/${examId}`, { token: studentToken })).status, 403);
  assert.equal((await request("/submissions", { method: "POST", token: studentToken, body: { examId } })).status, 403);

  // Mở lại cho Khối Kỹ thuật (KY_THUAT) -> sinh viên Khối Kỹ thuật xem và làm bài bình thường
  assert.equal(
    (await request(`/exams/${examId}`, {
      method: "PUT",
      token: teacherToken,
      body: { ...examForm(), isPublished: 1, majorGroup: "KY_THUAT" },
    })).status,
    200
  );
  assert.equal((await request(`/exams/${examId}`, { method: "PUT", token: teacherToken, body: { ...examForm(), questionIds: [1] } })).status, 400);
  const detail = await request(`/exams/${examId}`, { token: studentToken });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.options_pre_shuffled, true);
  assert.equal(detail.body.data.questions.length, 1);
  assert.equal(detail.body.data.questions[0].correct_answer, undefined);
  assert.equal(detail.body.data.questions[0].explanation, undefined);
  studentAttemptAnswerKey = findOptionKeyByText(detail.body.data.questions[0], "A");
  assert.ok(["A", "B", "C", "D"].includes(studentAttemptAnswerKey));
});

test("Chấm điểm ở server; khóa đáp án khi đề đang mở và mở khóa khi đề đóng; lưu thời gian mất focus", async () => {
  for (const change of [{ answers: null }, { answers: [] }, { answers: { [questionId]: "X" } }, { answers: { 999999: "A" } }, { timeSpentSeconds: -1 }, { timeSpentSeconds: 301 }, { timeSpentSeconds: [] }]) {
    assert.equal((await request("/submissions", { method: "POST", token: studentToken, body: { examId, ...change } })).status, 400);
  }
  const result = await request("/submissions", {
    method: "POST",
    token: studentToken,
    body: {
      examId,
      answers: { [questionId]: studentAttemptAnswerKey },
      timeSpentSeconds: 10,
      unfocused_seconds: 7,
      score: 0,
    },
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.score, 10);

  const openDetailStudent = await request(`/submissions/${result.body.data.submissionId}`, { token: studentToken });
  assert.equal(openDetailStudent.status, 200);
  assert.equal(openDetailStudent.body.data.can_view_answers, false);
  assert.equal(openDetailStudent.body.data.options_pre_shuffled, true);
  assert.equal(openDetailStudent.body.data.questions[0].correct_answer, undefined);
  assert.equal(openDetailStudent.body.data.questions[0].correct_option, undefined);
  assert.equal(openDetailStudent.body.data.questions[0].is_correct, undefined);
  assert.equal(openDetailStudent.body.data.questions[0].explanation, undefined);

  const openDetailTeacher = await request(`/submissions/${result.body.data.submissionId}`, { token: teacherToken });
  assert.equal(openDetailTeacher.status, 200);
  assert.equal(openDetailTeacher.body.data.can_view_answers, true);
  assert.equal(openDetailTeacher.body.data.unfocused_seconds, 7);
  assert.equal(openDetailTeacher.body.data.questions[0].is_correct, true);

  const other = await request("/auth/login", { method: "POST", body: { email: "giang.lth@ptit.edu.vn", password: "123456" } });
  assert.equal((await request(`/submissions/${result.body.data.submissionId}`, { token: other.body.data.token })).status, 403);
});

test("Giữ lịch sử: cho phép sửa metadata đề & sửa câu hỏi tự chấm lại điểm, mở khóa đáp án sau khi đóng đề", async () => {
  const mySubs = await request("/submissions/my-history", { token: studentToken });
  const subId = mySubs.body.data.find((s) => s.exam_id === examId).id;
  const updateExamRes = await request(`/exams/${examId}`, { method: "PUT", token: teacherToken, body: examForm() });
  assert.equal(updateExamRes.status, 200);

  const closedDetailStudent = await request(`/submissions/${subId}`, { token: studentToken });
  assert.equal(closedDetailStudent.status, 200);
  assert.equal(closedDetailStudent.body.data.can_view_answers, true);
  assert.equal(closedDetailStudent.body.data.options_pre_shuffled, true);
  assert.equal(closedDetailStudent.body.data.questions[0].is_correct, true);
  assert.equal(closedDetailStudent.body.data.questions[0].correct_answer, studentAttemptAnswerKey);

  assert.equal((await request(`/exams/${examId}`, { method: "DELETE", token: teacherToken })).status, 409);
  assert.equal((await request(`/questions/${questionId}`, { method: "DELETE", token: teacherToken })).status, 409);
  const updateQuestionRes = await request(`/questions/${questionId}`, {
    method: "PUT",
    token: teacherToken,
    body: {
      subjectId,
      content: "Chọn A (đã cập nhật)",
      optionA: "A",
      optionB: "B",
      optionC: "C",
      optionD: "D",
      correctAnswer: "A",
      difficulty: "EASY",
    },
  });
  assert.equal(updateQuestionRes.status, 200);
  assert.equal(updateQuestionRes.body.data.regradedSubmissionsCount, 1);
  assert.equal((await request(`/subjects/${subjectId}`, { method: "DELETE", token: teacherToken })).status, 409);
  assert.equal((await request(`/subjects/${subjectId}`, { method: "PUT", token: teacherToken, body: { code: "NEW", name: "Tên mới" } })).status, 409);
});

test("Single Active Session và httpOnly Cookie: đăng nhập nơi khác vô hiệu hóa phiên cũ với 401 SESSION_REPLACED", async () => {
  const login1 = await request("/auth/login", {
    method: "POST",
    body: { email: "DucPA.B25CC302@stu.ptit.edu.vn", password: "TestPass123" },
  });
  assert.equal(login1.status, 200);
  const setCookie1 = login1.headers.get("set-cookie") || "";
  assert.match(setCookie1, /ptit_access_token=/);
  assert.match(setCookie1, /HttpOnly/i);
  assert.match(setCookie1, /SameSite=Lax/i);
  const cookiePair1 = setCookie1.split(";")[0];

  const me1 = await request("/auth/me", { cookie: cookiePair1 });
  assert.equal(me1.status, 200);
  assert.equal(me1.body.data.email, "ducpa.b25cc302@stu.ptit.edu.vn");

  const login2 = await request("/auth/login", {
    method: "POST",
    body: { email: "DucPA.B25CC302@stu.ptit.edu.vn", password: "TestPass123" },
  });
  assert.equal(login2.status, 200);
  const cookiePair2 = (login2.headers.get("set-cookie") || "").split(";")[0];

  const kickedRes = await request("/auth/me", { cookie: cookiePair1 });
  assert.equal(kickedRes.status, 401);
  assert.equal(kickedRes.body.code, "SESSION_REPLACED");

  const me2 = await request("/auth/me", { cookie: cookiePair2 });
  assert.equal(me2.status, 200);

  const logoutRes = await request("/auth/logout", { method: "POST", cookie: cookiePair2 });
  assert.equal(logoutRes.status, 200);
  assert.equal((await request("/auth/me", { cookie: cookiePair2 })).status, 401);
});

test("Rút ngẫu nhiên câu hỏi theo độ khó, trộn thứ tự câu hỏi/đáp án và thống kê bài làm bất thường cho Giám thị", async () => {
  const subRes = await request("/subjects", {
    method: "POST",
    token: teacherToken,
    body: { code: "BANK202", name: "Ngân hàng kiểm thử Gói 2" },
  });
  assert.equal(subRes.status, 201);
  const bankSubjectId = subRes.body.data.id;

  const difficulties = [
    "EASY", "EASY", "EASY",
    "MEDIUM", "MEDIUM", "MEDIUM",
    "HARD", "HARD", "HARD",
  ];
  const createdQuestions = [];
  for (let i = 0; i < difficulties.length; i++) {
    const qRes = await request("/questions", {
      method: "POST",
      token: teacherToken,
      body: {
        subjectId: bankSubjectId,
        content: `Câu ngân hàng #${i + 1} (${difficulties[i]})`,
        optionA: `RIGHT_${i + 1}`,
        optionB: `WRONG_SHARED_${i + 1}`,
        optionC: `WRONG_ALT1_${i + 1}`,
        optionD: `WRONG_ALT2_${i + 1}`,
        correctAnswer: "A",
        difficulty: difficulties[i],
      },
    });
    assert.equal(qRes.status, 201);
    createdQuestions.push(qRes.body.data.id);
  }

  const dynamicExamRes = await request("/exams", {
    method: "POST",
    token: teacherToken,
    body: {
      subjectId: bankSubjectId,
      title: "Đề ma trận động 2-2-1",
      description: "Rút ngẫu nhiên từ ngân hàng",
      durationMinutes: 15,
      passScore: 5,
      isPublished: 1,
      easyCount: 2,
      mediumCount: 2,
      hardCount: 1,
      questionIds: createdQuestions.slice(0, 5),
    },
  });
  assert.equal(dynamicExamRes.status, 201);
  const dynamicExamId = dynamicExamRes.body.data.id;

  const take1 = await request(`/exams/${dynamicExamId}?mode=take`, { token: studentToken });
  assert.equal(take1.status, 200);
  assert.equal(take1.body.data.options_pre_shuffled, true);
  assert.equal(take1.body.data.questions.length, 5);

  const diffCounts = { EASY: 0, MEDIUM: 0, HARD: 0 };
  for (const q of take1.body.data.questions) {
    diffCounts[q.difficulty] = (diffCounts[q.difficulty] || 0) + 1;
    assert.equal(q.correct_answer, undefined);
  }
  assert.deepEqual(diffCounts, { EASY: 2, MEDIUM: 2, HARD: 1 });

  const take1Reload = await request(`/exams/${dynamicExamId}?mode=take`, { token: studentToken });
  assert.deepEqual(
    take1Reload.body.data.questions.map((q) => [q.id, q.option_a, q.option_b, q.option_c, q.option_d]),
    take1.body.data.questions.map((q) => [q.id, q.option_a, q.option_b, q.option_c, q.option_d])
  );

  const fullScoreAnswers = {};
  for (const q of take1.body.data.questions) {
    const idxMatch = q.content.match(/#(\d+)/);
    fullScoreAnswers[q.id] = findOptionKeyByText(q, `RIGHT_${idxMatch[1]}`);
  }
  const dynSub = await request("/submissions", {
    method: "POST",
    token: studentToken,
    body: { examId: dynamicExamId, answers: fullScoreAnswers, timeSpentSeconds: 200 },
  });
  assert.equal(dynSub.status, 201);
  assert.equal(dynSub.body.data.score, 10);

  const anomSubRes = await request("/subjects", {
    method: "POST",
    token: teacherToken,
    body: { code: "ANOM202", name: "Môn kiểm thử thống kê bất thường" },
  });
  assert.equal(anomSubRes.status, 201);
  const anomSubjectId = anomSubRes.body.data.id;

  const anomDiffs = ["EASY", "EASY", "MEDIUM", "MEDIUM", "HARD"];
  const fixed5Ids = [];
  for (let i = 0; i < anomDiffs.length; i++) {
    const qRes = await request("/questions", {
      method: "POST",
      token: teacherToken,
      body: {
        subjectId: anomSubjectId,
        content: `Câu giám sát #${i + 1}`,
        optionA: `RIGHT_${i + 1}`,
        optionB: `WRONG_SHARED_${i + 1}`,
        optionC: `WRONG_ALT1_${i + 1}`,
        optionD: `WRONG_ALT2_${i + 1}`,
        correctAnswer: "A",
        difficulty: anomDiffs[i],
      },
    });
    assert.equal(qRes.status, 201);
    fixed5Ids.push(qRes.body.data.id);
  }

  const anomalyExamRes = await request("/exams", {
    method: "POST",
    token: teacherToken,
    body: {
      subjectId: anomSubjectId,
      title: "Đề kiểm tra thống kê bất thường Giám thị",
      description: "",
      durationMinutes: 30,
      passScore: 5,
      isPublished: 1,
      easyCount: 2,
      mediumCount: 2,
      hardCount: 1,
    },
  });
  assert.equal(anomalyExamRes.status, 201);
  const anomalyExamId = anomalyExamRes.body.data.id;

  const ducLogin = await request("/auth/login", {
    method: "POST",
    body: { email: "DucPA.B25CC302@stu.ptit.edu.vn", password: "TestPass123" },
  });
  const ducToken = ducLogin.body.data.token;

  for (const tok of [studentToken, ducToken]) {
    const attemptRes = await request(`/exams/${anomalyExamId}?mode=take`, { token: tok });
    assert.equal(attemptRes.status, 200);
    const colludingAnswers = {};
    for (const q of attemptRes.body.data.questions) {
      const idx = Number(q.content.match(/#(\d+)/)[1]);
      if (q.id === fixed5Ids[0]) {
        colludingAnswers[q.id] = findOptionKeyByText(q, `RIGHT_${idx}`);
      } else {
        colludingAnswers[q.id] = findOptionKeyByText(q, `WRONG_SHARED_${idx}`);
      }
    }
    const sRes = await request("/submissions", {
      method: "POST",
      token: tok,
      body: {
        examId: anomalyExamId,
        answers: colludingAnswers,
        timeSpentSeconds: 45,
        unfocused_seconds: 150,
      },
    });
    assert.equal(sRes.status, 201);
    assert.equal(sRes.body.data.score, 2);
  }

  const lbRes = await request(`/exams/${anomalyExamId}/leaderboard`, { token: teacherToken });
  assert.equal(lbRes.status, 200);
  assert.equal(lbRes.body.data.anomalySummary.fastCount, 2);
  assert.equal(lbRes.body.data.anomalySummary.highViolationOrUnfocusCount, 2);
  assert.equal(lbRes.body.data.anomalySummary.collusionStudentCount, 2);
  assert.equal(lbRes.body.data.anomalySummary.suspiciousPairCount, 1);
  assert.equal(lbRes.body.data.suspiciousPairs[0].sameWrongCount, 4);

  const allSubsRes = await request(`/submissions?examId=${anomalyExamId}`, { token: teacherToken });
  assert.equal(allSubsRes.status, 200);
  assert.equal(allSubsRes.body.meta.anomalySummary.suspiciousPairCount, 1);
  assert.equal(allSubsRes.body.data.every((r) => r.is_fast_completion && r.is_high_unfocus && r.is_collusion_suspect), true);
});

test("Socket.IO Real-time Proctoring: xác thực Cookie httpOnly, phân tách Room, mất focus, vi phạm và duyệt lỗi đồng bộ 2 chiều", async () => {
  const waitForEvent = (sock, eventName, predicate = () => true, timeoutMs = 4000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        sock.off(eventName, handler);
        reject(new Error(`Timeout waiting for ${eventName}`));
      }, timeoutMs);
      const handler = (payload) => {
        if (predicate(payload)) {
          clearTimeout(timer);
          sock.off(eventName, handler);
          resolve(payload);
        }
      };
      sock.on(eventName, handler);
    });

  const unauthSocket = createClientSocket(socketUrl, {
    transports: ["websocket"],
    reconnection: false,
  });
  const unauthErr = await new Promise((resolve) => {
    unauthSocket.once("connect_error", (err) => resolve(err));
  });
  assert.ok(unauthErr);
  unauthSocket.disconnect();

  const rtExamRes = await request("/exams", {
    method: "POST",
    cookie: teacherCookie,
    body: {
      ...examForm(),
      title: "Đề Giám sát Socket Real-time",
      isPublished: 1,
      antiCheat: 1,
      maxTabSwitches: 3,
    },
  });
  assert.equal(rtExamRes.status, 201);
  const rtExamId = rtExamRes.body.data.id;

  const stuLogin = await request("/auth/login", {
    method: "POST",
    body: { email: "DucPA.B25CC302@stu.ptit.edu.vn", password: "TestPass123" },
  });
  assert.equal(stuLogin.status, 200);
  const stuCookie = (stuLogin.headers.get("set-cookie") || "").split(";")[0];

  const proctorSocket = createClientSocket(socketUrl, {
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: { Cookie: teacherCookie },
  });
  const studentSocket = createClientSocket(socketUrl, {
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: { Cookie: stuCookie },
  });

  try {
    await Promise.all([
      new Promise((res, rej) => {
        proctorSocket.once("connect", res);
        proctorSocket.once("connect_error", rej);
      }),
      new Promise((res, rej) => {
        studentSocket.once("connect", res);
        studentSocket.once("connect_error", rej);
      }),
    ]);

    let leakedToStudent = false;
    studentSocket.on("proctor:student_update", () => {
      leakedToStudent = true;
    });
    studentSocket.emit("proctor:watch_exam", { examId: rtExamId });

    const watchAck = await new Promise((resolve) =>
      proctorSocket.emit("proctor:watch_exam", { examId: rtExamId }, resolve)
    );
    assert.equal(watchAck.success, true);

    const takeRes = await request(`/exams/${rtExamId}?mode=take`, { cookie: stuCookie });
    assert.equal(takeRes.status, 200);
    const rightOption = findOptionKeyByText(takeRes.body.data.questions[0], "A");

    const enterProctorUpdate = waitForEvent(
      proctorSocket,
      "proctor:student_update",
      (p) => p.examId === rtExamId && p.student?.live_status === "WORKING"
    );
    await new Promise((resolve) =>
      studentSocket.emit(
        "student:exam_enter",
        { examId: rtExamId, isFocused: true, unfocusedSeconds: 0 },
        resolve
      )
    );
    await enterProctorUpdate;

    const blurUpdatePromise = waitForEvent(
      proctorSocket,
      "proctor:student_update",
      (p) => p.examId === rtExamId && p.student?.live_status === "UNFOCUSED"
    );
    studentSocket.emit("student:focus_change", {
      examId: rtExamId,
      isFocused: false,
      unfocusedSeconds: 4,
    });
    const blurPayload = await blurUpdatePromise;
    assert.equal(blurPayload.student.unfocused_seconds, 4);

    const focusBackPromise = waitForEvent(
      proctorSocket,
      "proctor:student_update",
      (p) => p.examId === rtExamId && p.student?.live_status === "WORKING"
    );
    studentSocket.emit("student:focus_change", {
      examId: rtExamId,
      isFocused: true,
      unfocusedSeconds: 5,
    });
    const focusPayload = await focusBackPromise;
    assert.equal(focusPayload.student.unfocused_seconds, 5);

    const violationPromise = waitForEvent(
      proctorSocket,
      "proctor:violation_new",
      (p) => p.examId === rtExamId
    );
    const sharedEventId = "evt_realtime_dedup_001";
    const vioAck = await new Promise((resolve) =>
      studentSocket.emit(
        "student:violation",
        {
          examId: rtExamId,
          reason: "Rời tab hoặc thu nhỏ trình duyệt",
          unfocusedSeconds: 6,
          answers: { [questionId]: rightOption },
          clientEventId: sharedEventId,
        },
        resolve
      )
    );
    assert.equal(vioAck.success, true);
    assert.equal(vioAck.data.tabSwitchCount, 1);

    const dupHttpVio = await request(`/exams/${rtExamId}/violation`, {
      method: "POST",
      cookie: stuCookie,
      body: {
        reason: "Rời tab hoặc thu nhỏ trình duyệt",
        unfocused_seconds: 6,
        clientEventId: sharedEventId,
      },
    });
    assert.equal(dupHttpVio.status, 200);
    assert.equal(dupHttpVio.body.data.tabSwitchCount, 1);

    const newVioEvent = await violationPromise;
    const violationId = newVioEvent.violation.id;
    assert.equal(newVioEvent.violation.status, "PENDING");
    assert.equal(leakedToStudent, false);

    const studentForgivenPromise = waitForEvent(
      studentSocket,
      "student:violation_reviewed",
      (p) => p.examId === rtExamId && p.decision === "DISMISSED"
    );
    const proctorForgivenPromise = waitForEvent(
      proctorSocket,
      "proctor:violation_reviewed",
      (p) => p.examId === rtExamId && p.decision === "DISMISSED"
    );

    const dismissRes = await request(
      `/exams/${rtExamId}/violations/${violationId}/review`,
      {
        method: "PATCH",
        cookie: teacherCookie,
        body: { decision: "DISMISSED" },
      }
    );
    assert.equal(dismissRes.status, 200);
    assert.equal(dismissRes.body.data.validViolationCount, 0);

    const [stuForgiven, procForgiven] = await Promise.all([
      studentForgivenPromise,
      proctorForgivenPromise,
    ]);
    assert.equal(stuForgiven.validViolationCount, 0);
    assert.equal(procForgiven.student.tab_switch_count, 0);

    const studentConfirmedPromise = waitForEvent(
      studentSocket,
      "student:violation_reviewed",
      (p) => p.examId === rtExamId && p.decision === "CONFIRMED"
    );
    const confirmRes = await request(
      `/exams/${rtExamId}/violations/${violationId}/review`,
      {
        method: "PATCH",
        cookie: teacherCookie,
        body: { decision: "CONFIRMED" },
      }
    );
    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.body.data.validViolationCount, 1);
    const stuConfirmed = await studentConfirmedPromise;
    assert.equal(stuConfirmed.validViolationCount, 1);

    const submittedUpdatePromise = waitForEvent(
      proctorSocket,
      "proctor:student_update",
      (p) => p.examId === rtExamId && p.student?.live_status === "SUBMITTED"
    );
    const subRes = await request("/submissions", {
      method: "POST",
      cookie: stuCookie,
      body: {
        examId: rtExamId,
        answers: { [questionId]: rightOption },
        timeSpentSeconds: 30,
        tab_switch_count: 1,
        unfocused_seconds: 6,
      },
    });
    assert.equal(subRes.status, 201);
    const submittedPayload = await submittedUpdatePromise;
    assert.equal(submittedPayload.student.score, 10);
    assert.equal(submittedPayload.student.tab_switch_count, 1);
  } finally {
    proctorSocket.disconnect();
    studentSocket.disconnect();
  }
});

test("Đối chiếu thời gian thực tế (+15s trễ mạng), chốt điểm theo đáp án lưu gần nhất và Rate Limit nộp bài", async () => {
  const exRes = await request("/exams", {
    method: "POST",
    token: teacherToken,
    body: { ...examForm(), title: "Đề kiểm tra timeout & rate limit", isPublished: 1, antiCheat: 1, maxTabSwitches: 1 },
  });
  assert.equal(exRes.status, 201);
  const timedExamId = exRes.body.data.id;

  const otherLogin = await request("/auth/login", {
    method: "POST",
    body: { email: "giang.lth@ptit.edu.vn", password: "123456" },
  });
  const secondStudentToken = otherLogin.body.data.token;

  const timedTake = await request(`/exams/${timedExamId}?mode=take`, { token: secondStudentToken });
  assert.equal(timedTake.status, 200);
  const rightKey = findOptionKeyByText(timedTake.body.data.questions[0], "A");
  const wrongKey = rightKey === "A" ? "B" : "A";

  const syncRes = await request(`/exams/${timedExamId}/progress`, {
    method: "PUT",
    token: secondStudentToken,
    body: { answers: { [questionId]: rightKey }, unfocused_seconds: 12 },
  });
  assert.equal(syncRes.status, 200);

  await pool.query(
    "UPDATE exam_attempts SET started_at = DATE_SUB(NOW(), INTERVAL 320 SECOND) WHERE exam_id = ? AND user_id = (SELECT id FROM users WHERE email = 'giang.lth@ptit.edu.vn')",
    [timedExamId]
  );

  const lateSub = await request("/submissions", {
    method: "POST",
    token: secondStudentToken,
    body: { examId: timedExamId, answers: { [questionId]: wrongKey }, timeSpentSeconds: 300, unfocused_seconds: 20 },
  });
  assert.equal(lateSub.status, 400);
  assert.equal(lateSub.body.isExpired, true);
  assert.equal(lateSub.body.data.score, 10);

  const overwriteSub = await request("/submissions", {
    method: "POST",
    token: secondStudentToken,
    body: { examId: timedExamId, answers: { [questionId]: wrongKey }, timeSpentSeconds: 300 },
  });
  assert.equal(overwriteSub.status, 409);

  let hitRateLimit = false;
  for (let i = 0; i < 16; i++) {
    const r = await request("/submissions", {
      method: "POST",
      token: secondStudentToken,
      body: { examId: timedExamId, answers: {} },
    });
    if (r.status === 429) {
      hitRateLimit = true;
      break;
    }
  }
  assert.equal(hitRateLimit, true);
});
