import type { QuestionItem, ResponseLog } from "@prisma/client";

export const IRT = {
  passTheta: 0.5,
  minQuestions: 10,
  maxQuestions: 18,
  seStop: 0.3,
  thetaMin: -4,
  thetaMax: 4,
  cooldownHours: 24
};

type ResponseLike = Pick<ResponseLog, "questionId" | "isCorrect">;
type QuestionLike = Pick<QuestionItem, "id" | "difficulty" | "discrimination" | "guessing">;

export function probability(theta: number, question: QuestionLike) {
  const a = question.discrimination;
  const b = question.difficulty;
  const c = question.guessing;
  return c + (1 - c) / (1 + Math.exp(-1.702 * a * (theta - b)));
}

export function information(theta: number, question: QuestionLike) {
  const p = probability(theta, question);
  const q = 1 - p;
  if (p <= 0 || q <= 0 || question.guessing >= 1) return 0;
  const inner = (1.702 * question.discrimination * (p - question.guessing)) / (1 - question.guessing);
  return (inner * inner * q) / p;
}

export function estimateEap(responses: ResponseLike[], questions: QuestionLike[]) {
  if (responses.length === 0) return { theta: 0, se: 99 };
  const questionMap = new Map(questions.map((q) => [q.id, q]));
  const grid: number[] = [];
  for (let theta = IRT.thetaMin; theta <= IRT.thetaMax + 0.0001; theta += 0.1) {
    grid.push(Number(theta.toFixed(1)));
  }

  const weights = grid.map((theta) => {
    const prior = Math.exp(-(theta * theta) / 2);
    const likelihood = responses.reduce((acc, response) => {
      const question = questionMap.get(response.questionId);
      if (!question) return acc;
      const p = Math.min(0.999999, Math.max(0.000001, probability(theta, question)));
      return acc * (response.isCorrect ? p : 1 - p);
    }, 1);
    return prior * likelihood;
  });

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return { theta: 0, se: 99 };

  const mean = grid.reduce((sum, theta, index) => sum + theta * weights[index], 0) / total;
  const variance = grid.reduce((sum, theta, index) => sum + (theta - mean) ** 2 * weights[index], 0) / total;

  return {
    theta: clamp(mean),
    se: Math.sqrt(Math.max(variance, 0.0001))
  };
}

export function selectNextQuestion<T extends QuestionLike>(theta: number, questions: T[], usedQuestionIds: string[]) {
  const used = new Set(usedQuestionIds);
  return questions
    .filter((question) => !used.has(question.id))
    .sort((a, b) => information(theta, b) - information(theta, a))[0];
}

export function shouldStop(answered: number, se: number) {
  return answered >= IRT.maxQuestions || (answered >= IRT.minQuestions && se <= IRT.seStop);
}

export function certificationLevel(theta: number) {
  if (theta >= 1.5) return "Expert";
  if (theta >= 1.0) return "Proficient";
  if (theta >= IRT.passTheta) return "Foundation";
  return "Not Certified";
}

function clamp(value: number) {
  return Math.max(IRT.thetaMin, Math.min(IRT.thetaMax, value));
}
