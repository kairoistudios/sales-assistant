import type { Direction, LoopKind, Motion } from "./types";
import { businessDaysBetween, civilDate, holidayMap, type TimingConfig } from "./timing";

export interface RankInput {
  id: string;
  kind: LoopKind;
  direction: Direction;
  motion: Motion | null;
  stage: string | null;
  valueCents: number | null;
  nudgeStage: number;
  nextAt: Date;
  accountId: string | null;
}

export interface FeedbackSignal {
  kind: LoopKind | string;
  accountId: string | null;
  signal: "not_relevant" | "dismissed" | "edited" | "approved" | string;
}

export interface ScoreParts {
  urgency: number;
  value: number;
  stage: number;
  direction: number;
  motion: number;
  nudge: number;
  feedback: number;
}

const STAGE_WEIGHT: Record<string, number> = {
  contracting: 18,
  proposal: 14,
  implementation: 10,
  discovery: 6,
  qualifying: 4,
  new: 2,
  delayed: 16,
  closed_won: 0,
  closed_lost: 0,
};

export function valueScore(cents: number | null): number {
  if (!cents || cents <= 0) return 0;
  const dollars = cents / 100;
  return Math.max(0, Math.min(42, Math.round(Math.log10(dollars) * 12 - 40)));
}

export function feedbackAdjustment(signals: FeedbackSignal[], item: Pick<RankInput, "kind" | "accountId">): number {
  let kindAdj = 0;
  let accountAdj = 0;
  for (const signal of signals) {
    const delta =
      signal.signal === "not_relevant"
        ? -18
        : signal.signal === "dismissed"
          ? -4
          : signal.signal === "edited"
            ? -1
            : signal.signal === "approved"
              ? 2
              : 0;
    if (signal.kind === item.kind) kindAdj += delta;
    if (signal.signal === "not_relevant" && item.accountId && signal.accountId === item.accountId) {
      accountAdj -= 8;
    }
  }
  return Math.max(-40, Math.min(15, kindAdj)) + Math.max(-24, accountAdj);
}

export function scoreLoop(
  item: RankInput,
  now: Date,
  timeZone: string,
  config: TimingConfig,
  signals: FeedbackSignal[],
): { score: number; parts: ScoreParts } {
  const today = civilDate(now, timeZone);
  const dueCivil = civilDate(item.nextAt, timeZone);
  const holidays = holidayMap(config, today);
  let urgency = 0;
  if (dueCivil < today) {
    const late = Math.max(1, businessDaysBetween(dueCivil, today, holidays));
    urgency = Math.min(36, late * 12);
  } else if (dueCivil === today) {
    urgency = 18;
  }
  const parts: ScoreParts = {
    urgency,
    value: valueScore(item.valueCents),
    stage: item.stage ? (STAGE_WEIGHT[item.stage] ?? 0) : 0,
    direction: item.direction === "we_owe" ? 8 : 0,
    motion: item.motion === "grow" ? 3 : 0,
    nudge: item.nudgeStage * 6,
    feedback: feedbackAdjustment(signals, item),
  };
  const score = parts.urgency + parts.value + parts.stage + parts.direction + parts.motion + parts.nudge + parts.feedback;
  return { score, parts };
}

export function rankAndCap<T extends RankInput>(
  items: T[],
  cap: number,
  now: Date,
  timeZone: string,
  config: TimingConfig,
  signals: FeedbackSignal[],
): { selected: (T & { score: number; parts: ScoreParts })[]; held: (T & { score: number; parts: ScoreParts })[] } {
  const scored = items
    .map((item) => {
      const { score, parts } = scoreLoop(item, now, timeZone, config, signals);
      return { ...item, score, parts };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const valueDelta = (b.valueCents ?? 0) - (a.valueCents ?? 0);
      if (valueDelta !== 0) return valueDelta;
      const timeDelta = a.nextAt.getTime() - b.nextAt.getTime();
      if (timeDelta !== 0) return timeDelta;
      return a.id < b.id ? -1 : 1;
    });
  const limit = Math.max(1, cap);
  return { selected: scored.slice(0, limit), held: scored.slice(limit) };
}
