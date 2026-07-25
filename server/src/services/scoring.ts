// Mentimeter "Quiz Competition" style scoring: correct answers earn between
// 500-1000 points depending on how fast they were submitted relative to the
// slide's time limit. Wrong (or non-quiz) answers earn 0.
const MIN_POINTS = 500;
const MAX_POINTS = 1000;
const DEFAULT_TIME_LIMIT_SEC = 20;

export interface GradedSubmission {
  correct: boolean;
  points: number;
}

export function gradeSubmission(
  slideType: string,
  config: any,
  value: unknown,
  slideStartedAt: number | null
): GradedSubmission {
  const isQuiz = slideType === "MULTIPLE_CHOICE" && config?.isQuiz === true;
  if (!isQuiz || typeof config.correctIndex !== "number") {
    return { correct: false, points: 0 };
  }

  const correct = value === config.correctIndex;
  if (!correct) return { correct: false, points: 0 };

  const timeLimitSec = config.timeLimitSec ?? DEFAULT_TIME_LIMIT_SEC;
  const timeLimitMs = timeLimitSec * 1000;
  const startedAt = slideStartedAt ?? Date.now();
  const elapsedMs = Math.max(0, Math.min(Date.now() - startedAt, timeLimitMs));
  const speedFactor = 1 - elapsedMs / timeLimitMs; // 1 = instant, 0 = used all the time

  const points = Math.round(MIN_POINTS + (MAX_POINTS - MIN_POINTS) * speedFactor);
  return { correct: true, points };
}
