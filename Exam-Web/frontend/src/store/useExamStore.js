import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export const useExamStore = create(persist((set, get) => ({

  selectedSubjectId: "",
  searchQuery: "",
  setSelectedSubjectId: (subjectId) => set({ selectedSubjectId: subjectId }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  ownerId: null,
  deadline: 0,
  startedAt: null,
  tabSwitchCount: 0,
  activeExam: null,
  questions: [],
  currentIndex: 0,
  answers: {},
  flaggedQuestions: [],
  remainingSeconds: 0,
  totalSeconds: 0,

  startExamSession: (examData, userId) => {
    const saved = get();
    const baseDurationSec = (Number(examData.duration_minutes) || 30) * 60;
    const durationSec =
      Number.isFinite(Number(examData.effective_duration_seconds)) &&
      Number(examData.effective_duration_seconds) > 0
        ? Math.min(baseDurationSec, Math.floor(Number(examData.effective_duration_seconds)))
        : baseDurationSec;
    const parsedServerStart = examData.started_at ? Date.parse(examData.started_at) : NaN;
    const hasServerStart = Number.isFinite(parsedServerStart);
    const parsedCloseAt = examData.close_at ? Date.parse(examData.close_at) : NaN;
    const hasCloseAt = Number.isFinite(parsedCloseAt);
    let serverDeadline = hasServerStart ? parsedServerStart + durationSec * 1000 : null;
    if (serverDeadline !== null && hasCloseAt) {
      serverDeadline = Math.min(serverDeadline, parsedCloseAt);
    }
    const savedIds = (saved.questions || [])
      .map((q) => Number(q.id))
      .sort((a, b) => a - b)
      .join(",");
    const incomingIds = (examData.questions || [])
      .map((q) => Number(q.id))
      .sort((a, b) => a - b)
      .join(",");
    const sameAttemptStart =
      !hasServerStart ||
      !saved.startedAt ||
      Math.abs(Date.parse(saved.startedAt) - parsedServerStart) < 5000;

    if (
      saved.ownerId === userId &&
      saved.activeExam?.id === examData.id &&
      (hasServerStart || saved.totalSeconds === durationSec) &&
      savedIds !== "" &&
      savedIds === incomingIds &&
      sameAttemptStart
    ) {
      let effectiveDeadline = hasServerStart ? serverDeadline : saved.deadline;
      if (hasCloseAt) {
        effectiveDeadline = Math.min(effectiveDeadline, parsedCloseAt);
      }
      set({
        deadline: effectiveDeadline,
        activeExam: examData,
        questions: saved.questions,
        startedAt: hasServerStart
          ? new Date(parsedServerStart).toISOString()
          : saved.startedAt || new Date().toISOString(),
        tabSwitchCount: saved.tabSwitchCount || 0,
        remainingSeconds: Math.max(0, Math.ceil((effectiveDeadline - Date.now()) / 1000)),
        totalSeconds: durationSec,
      });
      return;
    }

    let resolvedDeadline = hasServerStart
      ? serverDeadline
      : Date.now() + durationSec * 1000;
    if (hasCloseAt) {
      resolvedDeadline = Math.min(resolvedDeadline, parsedCloseAt);
    }
    set({
      ownerId: userId,
      deadline: resolvedDeadline,
      startedAt: hasServerStart
        ? new Date(parsedServerStart).toISOString()
        : new Date().toISOString(),
      tabSwitchCount: 0,
      activeExam: examData,
      questions: examData.questions || [],
      currentIndex: 0,
      answers: {},
      flaggedQuestions: [],
      remainingSeconds: Math.max(0, Math.ceil((resolvedDeadline - Date.now()) / 1000)),
      totalSeconds: durationSec,
    });
  },

  incrementTabSwitch: () =>
    set((state) => ({
      tabSwitchCount: (state.tabSwitchCount || 0) + 1,
    })),

  setTabSwitchCount: (count) =>
    set({
      tabSwitchCount: Math.max(0, Number(count) || 0),
    }),

  selectAnswer: (questionId, optionKey) =>
    set((state) => state.deadline <= Date.now() ? {} : ({
      answers: {
        ...state.answers,
        [questionId]: optionKey,
      },
    })),

  toggleFlagQuestion: (questionId) =>
    set((state) => {
      const exists = state.flaggedQuestions.includes(questionId);
      return {
        flaggedQuestions: exists
          ? state.flaggedQuestions.filter((id) => id !== questionId)
          : [...state.flaggedQuestions, questionId],
      };
    }),

  goToQuestion: (index) => {
    const total = get().questions.length;
    if (index >= 0 && index < total) {
      set({ currentIndex: index });
    }
  },

  nextQuestion: () => {
    const { currentIndex, questions } = get();
    if (currentIndex < questions.length - 1) {
      set({ currentIndex: currentIndex + 1 });
    }
  },

  prevQuestion: () => {
    const { currentIndex } = get();
    if (currentIndex > 0) {
      set({ currentIndex: currentIndex - 1 });
    }
  },

  tickTimer: () =>
    set((state) => ({
      remainingSeconds: Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)),
    })),

  resetExamSession: () =>
    set({
      ownerId: null,
      deadline: 0,
      startedAt: null,
      tabSwitchCount: 0,
      activeExam: null,
      questions: [],
      currentIndex: 0,
      answers: {},
      flaggedQuestions: [],
      remainingSeconds: 0,
      totalSeconds: 0,
    }),
}), {
  name: "ptit_exam_session",
  storage: createJSONStorage(() => sessionStorage),
  partialize: (state) => ({
    ownerId: state.ownerId,
    deadline: state.deadline,
    startedAt: state.startedAt,
    tabSwitchCount: state.tabSwitchCount,
    activeExam: state.activeExam,
    questions: state.questions,
    currentIndex: state.currentIndex,
    answers: state.answers,
    flaggedQuestions: state.flaggedQuestions,
    totalSeconds: state.totalSeconds,
  }),
}));
