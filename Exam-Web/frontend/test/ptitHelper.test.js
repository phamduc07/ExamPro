import test from "node:test";
import assert from "node:assert/strict";
import { parsePtitEmail, KY_THUAT_MAJORS, KINH_TE_MAJORS } from "../src/utils/ptitHelper.js";

test("parsePtitEmail tách đúng MSV đầy đủ và phân đúng 15 ngành Kỹ thuật + 13 ngành Kinh tế", () => {
  assert.equal(Object.keys(KY_THUAT_MAJORS).length, 15);
  assert.equal(Object.keys(KINH_TE_MAJORS).length, 13);

  const sample = parsePtitEmail("DucPA.B25CC302@stu.ptit.edu.vn");
  assert.equal(sample.isValid, true);
  assert.equal(sample.studentId, "B25DCCC302");
  assert.equal(sample.majorCode, "CC");
  assert.equal(sample.majorGroup, "KY_THUAT");

  for (const code of Object.keys(KY_THUAT_MAJORS)) {
    const res = parsePtitEmail(`SvTest.N24${code}015@stu.ptit.edu.vn`);
    assert.equal(res.isValid, true, code);
    assert.equal(res.studentId, `N24DC${code}015`);
    assert.equal(res.majorGroup, "KY_THUAT");
  }

  for (const code of Object.keys(KINH_TE_MAJORS)) {
    const res = parsePtitEmail(`SvTest.B25${code}108@stu.ptit.edu.vn`);
    assert.equal(res.isValid, true, code);
    assert.equal(res.studentId, `B25DC${code}108`);
    assert.equal(res.majorGroup, "KINH_TE");
  }
});

test("parsePtitEmail từ chối email sai đuôi, thiếu tên viết tắt hoặc mã ngành ngoài 28 ngành", () => {
  for (const invalidEmail of [
    "",
    "ducpa@gmail.com",
    "B25CC302@stu.ptit.edu.vn",
    ".B25CC302@stu.ptit.edu.vn",
    "DucPA.X25CC302@stu.ptit.edu.vn",
    "DucPA.B25DCCC302@stu.ptit.edu.vn",
    "DucPA.B25ZZ302@stu.ptit.edu.vn",
  ]) {
    assert.equal(parsePtitEmail(invalidEmail).isValid, false, invalidEmail);
  }
});
