import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  examAnswersSchema,
  examInputSchema,
  gradeAnswers,
  orderByAttempt,
  scoreVisible,
} from "../src/examGrading.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

function makeQuestion(id, points, correctOptionId = null) {
  const options = ["الف", "ب", "ج"].map((label, index) => {
    const optionId = `${id}-opt${index}`;
    return {
      id: optionId,
      text: `گزینه ${label}`,
      isCorrect: correctOptionId ? optionId === correctOptionId : index === 0,
    };
  });
  return { id, points, prompt: `سوال ${id}`, options };
}

describe("gradeAnswers", () => {
  it("gives a perfect score when every answer is correct", () => {
    const questions = [makeQuestion("q1", 1), makeQuestion("q2", 2)];
    const answers = questions.map((question) => ({
      questionId: question.id,
      selectedOptionId: question.options[0].id,
    }));
    const result = gradeAnswers(questions, answers);
    assert.equal(result.correctCount, 2);
    assert.equal(result.earnedPoints, 3);
    assert.equal(result.totalPoints, 3);
    assert.equal(result.percent, 100);
    assert.equal(result.scoreOutOf20, 20);
  });

  it("gives zero when nothing is answered", () => {
    const questions = [makeQuestion("q1", 2)];
    const result = gradeAnswers(questions, []);
    assert.equal(result.correctCount, 0);
    assert.equal(result.earnedPoints, 0);
    assert.equal(result.percent, 0);
    assert.equal(result.scoreOutOf20, 0);
  });

  it("weights questions by their points", () => {
    const questions = [makeQuestion("q1", 3), makeQuestion("q2", 1)];
    const answers = [
      { questionId: "q1", selectedOptionId: questions[0].options[0].id }, // correct, 3 pts
      { questionId: "q2", selectedOptionId: questions[1].options[1].id }, // wrong, 0 pts
    ];
    const result = gradeAnswers(questions, answers);
    assert.equal(result.earnedPoints, 3);
    assert.equal(result.totalPoints, 4);
    assert.equal(result.percent, 75);
    assert.equal(result.scoreOutOf20, 15);
  });

  it("rounds percent and score to two decimals", () => {
    const questions = [makeQuestion("q1", 1), makeQuestion("q2", 1), makeQuestion("q3", 1)];
    const answers = [{ questionId: "q1", selectedOptionId: questions[0].options[0].id }];
    const result = gradeAnswers(questions, answers);
    assert.equal(result.percent, 33.33);
    assert.equal(result.scoreOutOf20, 6.67);
  });

  it("ignores answers to unknown questions and unknown options", () => {
    const questions = [makeQuestion("q1", 1)];
    const result = gradeAnswers(questions, [
      { questionId: "nope", selectedOptionId: "nope-opt" },
    ]);
    assert.equal(result.correctCount, 0);
    assert.equal(result.percent, 0);
  });

  it("treats a null selection as unanswered", () => {
    const questions = [makeQuestion("q1", 2)];
    const result = gradeAnswers(questions, [
      { questionId: "q1", selectedOptionId: null },
    ]);
    assert.equal(result.correctCount, 0);
    assert.equal(result.earnedPoints, 0);
  });

  it("marks per-answer correctness in the perAnswer map", () => {
    const questions = [makeQuestion("q1", 1), makeQuestion("q2", 1)];
    const answers = [
      { questionId: "q1", selectedOptionId: questions[0].options[0].id },
      { questionId: "q2", selectedOptionId: questions[1].options[2].id },
    ];
    const result = gradeAnswers(questions, answers);
    assert.equal(result.perAnswer.get("q1").isCorrect, true);
    assert.equal(result.perAnswer.get("q1").earnedPoints, 1);
    assert.equal(result.perAnswer.get("q2").isCorrect, false);
    assert.equal(result.perAnswer.get("q2").earnedPoints, 0);
  });
});

function validExamInput() {
  return {
    courseId: UUID_A,
    title: "آزمون میان‌ترم",
    availableFrom: "2026-11-20T08:00:00+03:30",
    availableUntil: "2026-11-20T10:00:00+03:30",
    durationMinutes: 45,
    questions: [
      {
        prompt: "کدام گزینه درست است؟",
        points: 2,
        options: [
          { text: "گزینه درست", isCorrect: true },
          { text: "گزینه نادرست یک", isCorrect: false },
          { text: "گزینه نادرست دو", isCorrect: false },
        ],
      },
    ],
  };
}

describe("examInputSchema", () => {
  it("parses a valid exam and applies defaults", () => {
    const parsed = examInputSchema.parse(validExamInput());
    assert.equal(parsed.passPercent, 50);
    assert.equal(parsed.resultsVisibility, "after_close");
    assert.equal(parsed.maxAttempts, 1);
    assert.equal(parsed.shuffleQuestions, true);
    assert.equal(parsed.shuffleOptions, true);
    assert.equal(parsed.questions[0].points, 2);
  });

  it("rejects an exam whose window ends before it starts", () => {
    const input = { ...validExamInput(), availableUntil: "2026-11-20T07:00:00+03:30" };
    assert.throws(() => examInputSchema.parse(input));
  });

  it("rejects duration longer than the availability window", () => {
    const input = { ...validExamInput(), durationMinutes: 121 };
    assert.throws(() => examInputSchema.parse(input));
  });

  it("accepts duration exactly equal to the availability window", () => {
    const input = { ...validExamInput(), durationMinutes: 120 };
    const parsed = examInputSchema.parse(input);
    assert.equal(parsed.durationMinutes, 120);
  });

  it("rejects a question with no correct option", () => {
    const input = validExamInput();
    input.questions[0].options = input.questions[0].options.map((option) => ({
      ...option,
      isCorrect: false,
    }));
    assert.throws(() => examInputSchema.parse(input));
  });

  it("rejects a question with two correct options", () => {
    const input = validExamInput();
    input.questions[0].options[1].isCorrect = true;
    assert.throws(() => examInputSchema.parse(input));
  });

  it("rejects duplicate option texts case-insensitively", () => {
    const input = validExamInput();
    input.questions[0].options[1].text = "گزینه درست";
    assert.throws(() => examInputSchema.parse(input));
  });

  it("rejects fewer than three options", () => {
    const input = validExamInput();
    input.questions[0].options = input.questions[0].options.slice(0, 2);
    assert.throws(() => examInputSchema.parse(input));
  });

  it("rejects more than five options", () => {
    const input = validExamInput();
    for (let index = 0; index < 3; index += 1) {
      input.questions[0].options.push({ text: `گزینه اضافه ${index}`, isCorrect: false });
    }
    assert.throws(() => examInputSchema.parse(input));
  });

  it("rejects more than twenty questions", () => {
    const input = validExamInput();
    input.questions = Array.from({ length: 21 }, (_, index) => ({
      prompt: `سوال شماره ${index + 1} با متن کافی`,
      points: 1,
      options: [
        { text: "الف", isCorrect: true },
        { text: "ب", isCorrect: false },
        { text: "ج", isCorrect: false },
      ],
    }));
    assert.throws(() => examInputSchema.parse(input));
  });

  it("rejects an empty title", () => {
    const input = { ...validExamInput(), title: "" };
    assert.throws(() => examInputSchema.parse(input));
  });
});

describe("orderByAttempt", () => {
  const items = Array.from({ length: 20 }, (_, index) => ({
    id: `item-${index}`,
  }));

  it("returns the original order when shuffling is disabled", () => {
    const ordered = orderByAttempt(items, UUID_A, false);
    assert.deepEqual(ordered.map((item) => item.id), items.map((item) => item.id));
  });

  it("is deterministic for the same attempt id", () => {
    const first = orderByAttempt(items, UUID_B, true).map((item) => item.id);
    const second = orderByAttempt(items, UUID_B, true).map((item) => item.id);
    assert.deepEqual(first, second);
  });

  it("contains the same items in a permuted order", () => {
    const ordered = orderByAttempt(items, UUID_C, true).map((item) => item.id);
    assert.deepEqual([...ordered].sort(), items.map((item) => item.id).sort());
  });

  it("produces different orders for different attempts", () => {
    const orders = new Set(
      Array.from({ length: 8 }, (_, index) =>
        orderByAttempt(items, `attempt-${index}`, true)
          .map((item) => item.id)
          .join(","),
      ),
    );
    assert.ok(orders.size > 1, "expected at least two distinct orders");
  });
});

describe("scoreVisible", () => {
  const baseExam = {
    resultsVisibility: "after_close",
    status: "published",
    availableUntil: "2030-01-01T00:00:00Z",
  };
  const submittedAttempt = { status: "submitted" };
  const now = new Date("2026-11-13T00:00:00Z");

  it("is invisible while the attempt is still open", () => {
    assert.equal(scoreVisible(baseExam, { status: "in_progress" }, now), false);
  });

  it("is visible immediately for immediate exams", () => {
    const exam = { ...baseExam, resultsVisibility: "immediate" };
    assert.equal(scoreVisible(exam, submittedAttempt, now), true);
  });

  it("stays invisible for hidden exams even after close", () => {
    const exam = { ...baseExam, resultsVisibility: "hidden", status: "closed" };
    assert.equal(scoreVisible(exam, submittedAttempt, now), false);
  });

  it("waits for the window or close for after_close exams", () => {
    assert.equal(scoreVisible(baseExam, submittedAttempt, now), false);
    const afterWindow = { ...baseExam, availableUntil: "2026-11-01T00:00:00Z" };
    assert.equal(scoreVisible(afterWindow, submittedAttempt, now), true);
    const closed = { ...baseExam, status: "closed" };
    assert.equal(scoreVisible(closed, submittedAttempt, now), true);
  });

  it("treats expired attempts like submitted ones", () => {
    const afterWindow = { ...baseExam, availableUntil: "2026-11-01T00:00:00Z" };
    assert.equal(scoreVisible(afterWindow, { status: "expired" }, now), true);
  });
});

describe("examAnswersSchema", () => {
  it("applies empty defaults", () => {
    const parsed = examAnswersSchema.parse({});
    assert.deepEqual(parsed.answers, []);
    assert.deepEqual(parsed.integrity, {});
  });

  it("accepts a valid integrity payload", () => {
    const parsed = examAnswersSchema.parse({
      answers: [{ questionId: UUID_A, selectedOptionId: null }],
      integrity: { tabSwitches: 2, fullscreenExits: 1 },
    });
    assert.equal(parsed.integrity.tabSwitches, 2);
    assert.equal(parsed.answers[0].questionId, UUID_A);
  });

  it("rejects more than twenty answers", () => {
    const answers = Array.from({ length: 21 }, () => ({
      questionId: UUID_A,
      selectedOptionId: null,
    }));
    assert.throws(() => examAnswersSchema.parse({ answers }));
  });
});
