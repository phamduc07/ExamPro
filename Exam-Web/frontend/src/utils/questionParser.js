export const SAMPLE_BULK_QUESTIONS = `Câu 1: Trong React Router v6, component nào được dùng để hiển thị các route con bên trong Layout?
A. <Switch />
B. <Outlet />
C. <RouterView />
D. <ChildRoute />
Đáp án: B
Giải thích: <Outlet /> đóng vai trò vùng giữ chỗ để render route con khớp với URL hiện tại.

Câu 2. Câu lệnh SQL nào dùng để lọc các nhóm dữ liệu SAU KHI đã gom nhóm bằng GROUP BY?
A) WHERE
B) ORDER BY
C) HAVING
D) DISTINCT
ĐA: C
Giải thích: WHERE lọc dòng trước khi gom nhóm, còn HAVING lọc nhóm sau khi thực hiện GROUP BY.

3) Giao thức nào đảm nhiệm việc phân giải tên miền thành địa chỉ IP?
a: DHCP
b: DNS
c: ICMP
d: ARP
Answer: B`;

const QUESTION_START_REGEX = /(?:^|\n)(?=(?:câu\s+\d+\s*[:.)]|\d+\s*[.)])\s*)/i;
const QUESTION_PREFIX_REGEX = /^(?:câu\s+\d+\s*[:.)]|\d+\s*[.)])\s*/i;
const OPTION_LINE_REGEX = /^([A-Da-d])\s*[.):]\s*(.*)$/;
const ANSWER_LINE_REGEX = /^(?:đáp\s*án|đa|answer)\s*[:.]?\s*([A-Da-d])\b/i;
const EXPLANATION_LINE_REGEX = /^(?:giải\s*thích|gt|explanation)\s*[:.]?\s*(.*)$/i;

export function validateParsedQuestion(question) {
  const errors = [];
  if (!question.content || !question.content.trim()) {
    errors.push("Thiếu nội dung câu hỏi");
  }
  const missingOpts = [
    ["A", question.optionA],
    ["B", question.optionB],
    ["C", question.optionC],
    ["D", question.optionD],
  ]
    .filter(([, val]) => !val || !val.trim())
    .map(([key]) => key);

  if (missingOpts.length > 0) {
    errors.push(`Thiếu phương án ${missingOpts.join(", ")}`);
  }
  if (!["A", "B", "C", "D"].includes(question.correctAnswer)) {
    errors.push("Thiếu đáp án đúng (chọn A/B/C/D)");
  }

  return {
    ...question,
    errors,
    isValid: errors.length === 0,
  };
}

export function parseBulkQuestions(rawText, defaultDifficulty = "MEDIUM") {
  if (typeof rawText !== "string" || !rawText.trim()) {
    return [];
  }

  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  const blocks = normalized
    .split(QUESTION_START_REGEX)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block, idx) => {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const contentLines = [];
    const options = { A: "", B: "", C: "", D: "" };
    let correctAnswer = "";
    const explanationLines = [];
    let currentSection = "CONTENT";
    let currentOptionKey = null;

    lines.forEach((line, lineIdx) => {
      const cleanedLine = lineIdx === 0 ? line.replace(QUESTION_PREFIX_REGEX, "").trim() : line;

      const answerMatch = cleanedLine.match(ANSWER_LINE_REGEX);
      if (answerMatch) {
        correctAnswer = answerMatch[1].toUpperCase();
        currentSection = "ANSWER";
        currentOptionKey = null;
        return;
      }

      const expMatch = cleanedLine.match(EXPLANATION_LINE_REGEX);
      if (expMatch) {
        currentSection = "EXPLANATION";
        currentOptionKey = null;
        if (expMatch[1].trim()) {
          explanationLines.push(expMatch[1].trim());
        }
        return;
      }

      const optMatch = cleanedLine.match(OPTION_LINE_REGEX);
      if (optMatch && currentSection !== "EXPLANATION") {
        const key = optMatch[1].toUpperCase();
        options[key] = optMatch[2].trim();
        currentSection = "OPTION";
        currentOptionKey = key;
        return;
      }

      if (currentSection === "EXPLANATION") {
        explanationLines.push(cleanedLine);
      } else if (currentSection === "OPTION" && currentOptionKey) {
        options[currentOptionKey] = `${options[currentOptionKey]} ${cleanedLine}`.trim();
      } else if (cleanedLine) {
        contentLines.push(cleanedLine);
      }
    });

    const content = contentLines.join("\n").trim();
    const explanation = explanationLines.join(" ").trim();

    return validateParsedQuestion({
      index: idx + 1,
      content,
      optionA: options.A,
      optionB: options.B,
      optionC: options.C,
      optionD: options.D,
      correctAnswer,
      difficulty: defaultDifficulty,
      explanation,
    });
  });
}
