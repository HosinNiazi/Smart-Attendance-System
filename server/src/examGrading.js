import crypto from "node:crypto";
import { z } from "zod";

export const EXAM_RESULTS_VISIBILITY = ["immediate", "after_close", "hidden"];

const examOptionSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  isCorrect: z.boolean().default(false),
});

const examQuestionSchema = z
  .object({
    prompt: z.string().trim().min(2).max(2000),
    points: z.number().positive().max(100).default(1),
    options: z.array(examOptionSchema).min(3).max(5),
  })
  .superRefine((question, ctx) => {
    const correct = question.options.filter((option) => option.isCorrect).length;
    if (correct !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "هر سوال باید دقیقاً یک گزینهٔ صحیح داشته باشد.",
      });
    }
    const texts = question.options.map((option) =>
      option.text.trim().toLocaleLowerCase("fa"),
    );
    if (new Set(texts).size !== texts.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "متن گزینه‌های یک سوال نباید تکراری باشد.",
      });
    }
  });

export const examInputSchema = z
  .object({
    courseId: z.string().uuid(),
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2000).optional().default(""),
    availableFrom: z.string().datetime({ offset: true }),
    availableUntil: z.string().datetime({ offset: true }),
    durationMinutes: z.number().int().min(1).max(240),
    passPercent: z.number().min(0).max(100).default(50),
    shuffleQuestions: z.boolean().default(true),
    shuffleOptions: z.boolean().default(true),
    resultsVisibility: z.enum(EXAM_RESULTS_VISIBILITY).default("after_close"),
    maxAttempts: z.number().int().min(1).max(3).default(1),
    questions: z.array(examQuestionSchema).min(1).max(20),
  })
  .superRefine((exam, ctx) => {
    const from = new Date(exam.availableFrom).getTime();
    const until = new Date(exam.availableUntil).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["availableUntil"],
        message: "پایان بازهٔ آزمون باید بعد از شروع آن باشد.",
      });
      return;
    }
    if (exam.durationMinutes * 60_000 > until - from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["durationMinutes"],
        message: "مدت پاسخ‌دهی نمی‌تواند از طول بازهٔ آزمون بیشتر باشد.",
      });
    }
  });

export const examAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        selectedOptionId: z.string().uuid().nullable().optional(),
      }),
    )
    .max(20)
    .default([]),
  integrity: z
    .object({
      tabSwitches: z.number().int().min(0).max(10_000).optional(),
      fullscreenExits: z.number().int().min(0).max(10_000).optional(),
    })
    .optional()
    .default({}),
});

export const examScheduleSchema = z.object({
  availableUntil: z.string().datetime({ offset: true }).optional(),
  resultsVisibility: z.enum(EXAM_RESULTS_VISIBILITY).optional(),
});

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function gradeAnswers(questions, answers) {
  const byQuestion = new Map(
    (answers || []).map((answer) => [
      String(answer.questionId),
      answer.selectedOptionId ? String(answer.selectedOptionId) : null,
    ]),
  );

  let correctCount = 0;
  let earnedPoints = 0;
  let totalPoints = 0;
  const perAnswer = new Map();

  for (const question of questions) {
    const points = Number(question.points) || 0;
    totalPoints += points;
    const selected = byQuestion.get(String(question.id)) || null;
    const correctOption = (question.options || []).find(
      (option) => option.isCorrect,
    );
    const isCorrect = Boolean(
      selected && correctOption && String(correctOption.id) === selected,
    );
    const earned = isCorrect ? points : 0;
    if (isCorrect) correctCount += 1;
    earnedPoints += earned;
    perAnswer.set(String(question.id), {
      selectedOptionId: selected,
      isCorrect,
      earnedPoints: earned,
    });
  }

  totalPoints = round2(totalPoints);
  earnedPoints = round2(earnedPoints);
  const percent =
    totalPoints > 0 ? round2((earnedPoints / totalPoints) * 100) : 0;
  const scoreOutOf20 = round2(percent / 5);

  return {
    correctCount,
    earnedPoints,
    totalPoints,
    percent,
    scoreOutOf20,
    perAnswer,
  };
}

// Deterministic per-attempt order: refreshing or resuming an attempt shows the
// same order, while two students see different orders.
export function orderByAttempt(items, attemptId, enabled) {
  if (!enabled || !items?.length) return items;
  return [...items].sort((a, b) => {
    const left = crypto
      .createHash("sha1")
      .update(`${attemptId}:${a.id}`)
      .digest("hex");
    const right = crypto
      .createHash("sha1")
      .update(`${attemptId}:${b.id}`)
      .digest("hex");
    return left.localeCompare(right);
  });
}

export function scoreVisible(exam, attempt, now = new Date()) {
  if (!attempt) return false;
  if (!["submitted", "expired"].includes(attempt.status)) return false;
  if (exam.resultsVisibility === "immediate") return true;
  if (exam.resultsVisibility === "hidden") return false;
  return (
    ["closed", "cancelled"].includes(exam.status) ||
    new Date(exam.availableUntil || exam.available_until).getTime() <=
      now.getTime()
  );
}
