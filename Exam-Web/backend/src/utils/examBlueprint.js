import crypto from "node:crypto";

export const DISPLAY_OPTION_KEYS = ["A", "B", "C", "D"];

export function cryptoShuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function parseAttemptBlueprint(rawBlueprint) {
  let parsed = rawBlueprint;
  if (!parsed) return null;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray(parsed.items) ||
    parsed.items.length === 0
  ) {
    return null;
  }

  const validItems = [];
  for (const item of parsed.items) {
    const qId = Number(item?.questionId);
    const ord = item?.optionOrder;
    if (
      !Number.isInteger(qId) ||
      qId <= 0 ||
      !Array.isArray(ord) ||
      ord.length !== 4 ||
      !DISPLAY_OPTION_KEYS.every((k) => ord.includes(k))
    ) {
      return null;
    }
    validItems.push({
      questionId: qId,
      optionOrder: [...ord],
    });
  }

  return {
    version: 1,
    items: validItems,
  };
}

export async function generateAttemptBlueprint(dbClient, exam, fallbackLinkedQuestions = []) {
  let easyTarget = Math.max(0, Number(exam.easy_count) || 0);
  let mediumTarget = Math.max(0, Number(exam.medium_count) || 0);
  let hardTarget = Math.max(0, Number(exam.hard_count) || 0);

  if (easyTarget + mediumTarget + hardTarget === 0 && fallbackLinkedQuestions.length > 0) {
    for (const q of fallbackLinkedQuestions) {
      if (q.difficulty === "EASY") easyTarget++;
      else if (q.difficulty === "HARD") hardTarget++;
      else mediumTarget++;
    }
  }

  const [bankRows] = await dbClient.query(
    "SELECT id, difficulty FROM questions WHERE subject_id = ?",
    [Number(exam.subject_id)]
  );

  const easyPool = cryptoShuffle(bankRows.filter((q) => q.difficulty === "EASY"));
  const mediumPool = cryptoShuffle(
    bankRows.filter((q) => (q.difficulty || "MEDIUM") === "MEDIUM")
  );
  const hardPool = cryptoShuffle(bankRows.filter((q) => q.difficulty === "HARD"));

  const chosenMap = new Map();
  for (const q of easyPool.slice(0, easyTarget)) {
    chosenMap.set(Number(q.id), q);
  }
  for (const q of mediumPool.slice(0, mediumTarget)) {
    chosenMap.set(Number(q.id), q);
  }
  for (const q of hardPool.slice(0, hardTarget)) {
    chosenMap.set(Number(q.id), q);
  }

  const expectedTotal = easyTarget + mediumTarget + hardTarget;
  if (chosenMap.size < expectedTotal) {
    const fallbackCandidates = cryptoShuffle([
      ...fallbackLinkedQuestions,
      ...bankRows,
    ]);
    for (const q of fallbackCandidates) {
      if (chosenMap.size >= expectedTotal) break;
      const qId = Number(q.id);
      if (qId > 0 && !chosenMap.has(qId)) {
        chosenMap.set(qId, q);
      }
    }
  }

  if (chosenMap.size === 0 && fallbackLinkedQuestions.length > 0) {
    for (const q of fallbackLinkedQuestions) {
      chosenMap.set(Number(q.id), q);
    }
  }

  const shouldShuffleQuestions = exam.shuffle_questions === undefined ? true : true;
  const orderedQuestions = shouldShuffleQuestions
    ? cryptoShuffle(Array.from(chosenMap.values()))
    : Array.from(chosenMap.values());

  const items = orderedQuestions.map((q) => ({
    questionId: Number(q.id),
    optionOrder: cryptoShuffle(DISPLAY_OPTION_KEYS),
  }));

  return {
    version: 1,
    items,
  };
}

function getDbOptionByKey(questionRow, key) {
  if (key === "A") return questionRow.option_a;
  if (key === "B") return questionRow.option_b;
  if (key === "C") return questionRow.option_c;
  return questionRow.option_d;
}

export function formatQuestionsWithBlueprint(
  blueprint,
  questionsById,
  { includeAnswers = false, parsedAnswers = {}, forExamRoom = false } = {}
) {
  const result = [];
  blueprint.items.forEach((item, index) => {
    const q = questionsById.get(Number(item.questionId));
    if (!q) return;

    const [kA, kB, kC, kD] = item.optionOrder;
    const base = {
      id: q.id,
      subject_id: q.subject_id,
      content: q.content,
      option_a: getDbOptionByKey(q, kA),
      option_b: getDbOptionByKey(q, kB),
      option_c: getDbOptionByKey(q, kC),
      option_d: getDbOptionByKey(q, kD),
      difficulty: q.difficulty,
      order_index: index + 1,
    };

    if (forExamRoom) {
      result.push(base);
      return;
    }

    const selectedDisplayKey =
      parsedAnswers[q.id] || parsedAnswers[String(q.id)] || null;

    if (!includeAnswers) {
      result.push({
        ...base,
        selected_option: selectedDisplayKey,
      });
      return;
    }

    const correctDisplayIdx = item.optionOrder.indexOf(q.correct_answer);
    const displayedCorrectKey =
      correctDisplayIdx >= 0 ? DISPLAY_OPTION_KEYS[correctDisplayIdx] : q.correct_answer;

    result.push({
      ...base,
      correct_answer: displayedCorrectKey,
      explanation: q.explanation,
      selected_option: selectedDisplayKey,
      is_correct: Boolean(selectedDisplayKey && selectedDisplayKey === displayedCorrectKey),
    });
  });

  return result;
}

export function gradeAnswersWithBlueprint(blueprint, questionsById, answersObj = {}) {
  let correctCount = 0;
  let totalQuestions = 0;

  for (const item of blueprint.items) {
    const q = questionsById.get(Number(item.questionId));
    if (!q) continue;
    totalQuestions++;

    const displayChoice = answersObj[q.id] || answersObj[String(q.id)] || null;
    if (!displayChoice) continue;

    const displayIdx = DISPLAY_OPTION_KEYS.indexOf(displayChoice);
    if (displayIdx === -1) continue;

    const originalDbKey = item.optionOrder[displayIdx];
    if (originalDbKey === q.correct_answer) {
      correctCount++;
    }
  }

  const score =
    totalQuestions > 0
      ? Number(((correctCount / totalQuestions) * 10).toFixed(2))
      : 0;

  return {
    correctCount,
    totalQuestions,
    score,
  };
}

function extractNormalizedWrongMap(submission, questionsById, defaultExamQuestionIds = []) {
  let parsedAnswers = submission.answers_json;
  if (typeof parsedAnswers === "string") {
    try {
      parsedAnswers = JSON.parse(parsedAnswers || "{}");
    } catch {
      parsedAnswers = {};
    }
  }
  if (!parsedAnswers || typeof parsedAnswers !== "object" || Array.isArray(parsedAnswers)) {
    parsedAnswers = {};
  }

  const blueprint = parseAttemptBlueprint(submission.attempt_blueprint_json);
  const wrongMap = new Map();
  const seenQuestionIds = new Set();

  if (blueprint) {
    for (const item of blueprint.items) {
      const q = questionsById.get(Number(item.questionId));
      if (!q) continue;
      seenQuestionIds.add(Number(q.id));
      const displayChoice = parsedAnswers[q.id] || parsedAnswers[String(q.id)] || null;
      if (!displayChoice) continue;
      const displayIdx = DISPLAY_OPTION_KEYS.indexOf(displayChoice);
      if (displayIdx === -1) continue;
      const originalDbKey = item.optionOrder[displayIdx];
      if (originalDbKey && originalDbKey !== q.correct_answer) {
        wrongMap.set(Number(q.id), originalDbKey);
      }
    }
  } else {
    const qIds =
      defaultExamQuestionIds.length > 0
        ? defaultExamQuestionIds
        : Object.keys(parsedAnswers).map(Number);
    for (const rawId of qIds) {
      const q = questionsById.get(Number(rawId));
      if (!q) continue;
      seenQuestionIds.add(Number(q.id));
      const choice = parsedAnswers[q.id] || parsedAnswers[String(q.id)] || null;
      if (choice && DISPLAY_OPTION_KEYS.includes(choice) && choice !== q.correct_answer) {
        wrongMap.set(Number(q.id), choice);
      }
    }
  }

  return { wrongMap, seenQuestionIds };
}

export function analyzeSubmissionsAnomalies(
  submissions,
  examsById,
  questionsById,
  examLinkedQuestionIdsMap = new Map()
) {
  const byExam = new Map();
  for (const sub of submissions) {
    const exId = Number(sub.exam_id);
    if (!byExam.has(exId)) byExam.set(exId, []);
    byExam.get(exId).push(sub);
  }

  const collusionBySubId = new Map();
  const suspiciousPairs = [];

  for (const [examId, examSubs] of byExam.entries()) {
    const exam = examsById.get(examId);
    const linkedQIds = examLinkedQuestionIdsMap.get(examId) || [];

    const latestByStudent = new Map();
    for (const sub of examSubs) {
      const sId = Number(sub.student_id);
      const subRowId = Number(sub.submission_id ?? sub.id);
      const prev = latestByStudent.get(sId);
      if (!prev || subRowId > Number(prev.submission_id ?? prev.id)) {
        latestByStudent.set(sId, sub);
      }
    }

    const candidates = Array.from(latestByStudent.values()).map((sub) => {
      const subRowId = Number(sub.submission_id ?? sub.id);
      const { wrongMap, seenQuestionIds } = extractNormalizedWrongMap(
        sub,
        questionsById,
        linkedQIds
      );
      return {
        sub,
        subRowId,
        wrongMap,
        seenQuestionIds,
      };
    });

    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i];
        const b = candidates[j];

        let sameWrongCount = 0;
        let unionWrongOnShared = 0;
        let aWrongOnShared = 0;
        let bWrongOnShared = 0;

        for (const qId of a.seenQuestionIds) {
          if (!b.seenQuestionIds.has(qId)) continue;
          const aWrong = a.wrongMap.get(qId) || null;
          const bWrong = b.wrongMap.get(qId) || null;
          if (aWrong) aWrongOnShared++;
          if (bWrong) bWrongOnShared++;
          if (aWrong || bWrong) {
            unionWrongOnShared++;
            if (aWrong && bWrong && aWrong === bWrong) {
              sameWrongCount++;
            }
          }
        }

        const minWrong = Math.min(aWrongOnShared, bWrongOnShared);
        if (sameWrongCount < 2 || unionWrongOnShared === 0 || minWrong === 0) {
          continue;
        }

        const jaccardRatio = sameWrongCount / unionWrongOnShared;
        const overlapRatio = sameWrongCount / minWrong;

        if (jaccardRatio >= 0.6 || overlapRatio >= 0.75) {
          const similarityPercent = Math.round(jaccardRatio * 100);
          const aName = a.sub.full_name || a.sub.student_name || "Sinh viên";
          const bName = b.sub.full_name || b.sub.student_name || "Sinh viên";
          const aCode = a.sub.student_code || `#${a.sub.student_id}`;
          const bCode = b.sub.student_code || `#${b.sub.student_id}`;

          suspiciousPairs.push({
            examId,
            examTitle: exam?.title || a.sub.exam_title || `Đề #${examId}`,
            sameWrongCount,
            unionWrongCount: unionWrongOnShared,
            similarityPercent,
            student1: {
              userId: a.sub.student_id,
              submissionId: a.subRowId,
              fullName: aName,
              studentCode: aCode,
              score: Number(a.sub.score),
            },
            student2: {
              userId: b.sub.student_id,
              submissionId: b.subRowId,
              fullName: bName,
              studentCode: bCode,
              score: Number(b.sub.score),
            },
          });

          if (!collusionBySubId.has(a.subRowId)) collusionBySubId.set(a.subRowId, []);
          collusionBySubId.get(a.subRowId).push({
            partnerName: bName,
            partnerCode: bCode,
            partnerSubmissionId: b.subRowId,
            sameWrongCount,
            similarityPercent,
          });

          if (!collusionBySubId.has(b.subRowId)) collusionBySubId.set(b.subRowId, []);
          collusionBySubId.get(b.subRowId).push({
            partnerName: aName,
            partnerCode: aCode,
            partnerSubmissionId: a.subRowId,
            sameWrongCount,
            similarityPercent,
          });
        }
      }
    }
  }

  suspiciousPairs.sort((x, y) => y.similarityPercent - x.similarityPercent || y.sameWrongCount - x.sameWrongCount);

  let fastCount = 0;
  let highViolationOrUnfocusCount = 0;
  let collusionStudentCount = 0;
  let totalAnomalousCount = 0;

  const enrichedSubmissions = submissions.map((sub) => {
    const subRowId = Number(sub.submission_id ?? sub.id);
    const exam = examsById.get(Number(sub.exam_id));
    const durationMinutes = Number(exam?.duration_minutes ?? sub.duration_minutes ?? 30) || 30;
    const durationSeconds = durationMinutes * 60;
    const timeSpent = Math.max(0, Number(sub.time_spent_seconds) || 0);
    const durationRatioPercent =
      durationSeconds > 0 ? Math.round((timeSpent / durationSeconds) * 100) : 100;

    const isSuspended = Number(sub.is_suspended) === 1;
    const isFastCompletion =
      !isSuspended &&
      Number(sub.total_questions) > 0 &&
      timeSpent < durationSeconds * 0.2;

    const maxAllowedTabs =
      Number(exam?.max_tab_switches) >= 1 ? Number(exam.max_tab_switches) : 3;
    const tabSwitches = Math.max(0, Number(sub.tab_switch_count) || 0);
    const unfocusedSec = Math.max(0, Number(sub.unfocused_seconds) || 0);

    const isHighViolation = tabSwitches >= 3 || tabSwitches >= maxAllowedTabs;
    const isHighUnfocus =
      unfocusedSec >= 30 || unfocusedSec >= Math.max(20, Math.round(durationSeconds * 0.15));

    const collusionMatches = collusionBySubId.get(subRowId) || [];
    const isCollusionSuspect = collusionMatches.length > 0;

    const anomalyFlags = [];
    if (isFastCompletion) anomalyFlags.push("FAST_SUBMIT");
    if (isHighViolation) anomalyFlags.push("HIGH_VIOLATION");
    if (isHighUnfocus) anomalyFlags.push("HIGH_UNFOCUS");
    if (isCollusionSuspect) anomalyFlags.push("WRONG_ANSWER_COLLUSION");

    const isAnomalous = anomalyFlags.length > 0;
    if (isFastCompletion) fastCount++;
    if (isHighViolation || isHighUnfocus) highViolationOrUnfocusCount++;
    if (isCollusionSuspect) collusionStudentCount++;
    if (isAnomalous) totalAnomalousCount++;

    return {
      ...sub,
      duration_ratio_percent: durationRatioPercent,
      anomaly_flags: anomalyFlags,
      is_anomalous: isAnomalous,
      is_fast_completion: isFastCompletion,
      is_high_violation: isHighViolation,
      is_high_unfocus: isHighUnfocus,
      is_collusion_suspect: isCollusionSuspect,
      collusion_matches: collusionMatches,
    };
  });

  return {
    enrichedSubmissions,
    suspiciousPairs,
    anomalySummary: {
      totalAnomalousCount,
      fastCount,
      highViolationOrUnfocusCount,
      collusionStudentCount,
      suspiciousPairCount: suspiciousPairs.length,
    },
  };
}
