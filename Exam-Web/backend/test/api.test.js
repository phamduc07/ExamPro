import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import "dotenv/config";

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
const sentOtps = new Map();
setMailSenderForTests(async ({ to, otp }) => {
  sentOtps.set(to, otp);
});
setEmailVerifierForTests(async (email) => !email.startsWith("khongtontai."));
let server;
let baseUrl;
let teacherToken;
let studentToken;
let subjectId;
let questionId;
let examId;

async function request(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

const examForm = () => ({ subjectId, title: "Đề kiểm thử", description: "", durationMinutes: 5, passScore: 0, isPublished: 0, questionIds: [questionId] });

before(async () => {
  await initializeDatabase();
  const app = express();
  app.use(express.json());
  app.use("/api", routes);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
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

  const studentRes = await request("/auth/login", {
    method: "POST",
    body: { email: "student@ptit.edu.vn", password: "123456" },
  });
  assert.equal(studentRes.status, 200);
  studentToken = studentRes.body.data.token;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
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
  assert.equal(detail.body.data.questions.length, 1);
  assert.equal(detail.body.data.questions[0].correct_answer, undefined);
  assert.equal(detail.body.data.questions[0].explanation, undefined);
});

test("Chấm điểm ở server; từ chối đáp án lạ, câu ngoài đề và thời gian âm", async () => {
  for (const change of [{ answers: null }, { answers: [] }, { answers: { [questionId]: "X" } }, { answers: { 999999: "A" } }, { timeSpentSeconds: -1 }, { timeSpentSeconds: 301 }, { timeSpentSeconds: [] }]) {
    assert.equal((await request("/submissions", { method: "POST", token: studentToken, body: { examId, ...change } })).status, 400);
  }
  const result = await request("/submissions", { method: "POST", token: studentToken, body: { examId, answers: { [questionId]: "A" }, timeSpentSeconds: 10, score: 0 } });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.score, 10);
  const detail = await request(`/submissions/${result.body.data.submissionId}`, { token: studentToken });
  assert.equal(detail.body.data.questions[0].is_correct, true);
  const other = await request("/auth/login", { method: "POST", body: { email: "giang.lth@ptit.edu.vn", password: "123456" } });
  assert.equal((await request(`/submissions/${result.body.data.submissionId}`, { token: other.body.data.token })).status, 403);
});

test("Giữ lịch sử: cho phép sửa metadata đề & sửa câu hỏi tự chấm lại điểm, vẫn cấm xóa đề/câu hỏi/môn đã có dữ liệu", async () => {
  const updateExamRes = await request(`/exams/${examId}`, { method: "PUT", token: teacherToken, body: examForm() });
  assert.equal(updateExamRes.status, 200);
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
