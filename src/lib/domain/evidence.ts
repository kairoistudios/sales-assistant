import type { Direction, LoopKind } from "./types";
import { civilDate, formatCivil, holidayMap, type TimingConfig } from "./timing";

export interface EvidenceInput {
  kind: LoopKind;
  direction: Direction;
  subject: string;
  nudgeStage: number;
  anchorAt: Date;
  dueOn?: string | null;
  dueIsStated?: boolean;
  timeZone: string;
  config: TimingConfig;
  now: Date;
}

function daysLabel(count: number): string {
  return count === 1 ? "1 business day" : `${count} business days`;
}

function lowerFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

export function buildEvidence(input: EvidenceInput): string {
  const timeZone = input.timeZone || input.config.fallbackTimeZone;
  const anchorOn = civilDate(input.anchorAt, timeZone);
  const anchorLabel = formatCivil(anchorOn);
  const upcoming = input.nudgeStage + 1;
  const kindTiming = input.config.kinds[input.kind] ?? input.config.kinds.other;
  const firstOffset = kindTiming.stages.find((stage) => stage.stage === 1)?.offsetBusinessDays ?? 2;
  const window = kindTiming.windowBusinessDays;

  const today = civilDate(input.now, timeZone);

  if (input.direction === "we_owe") {
    const dueLabel = input.dueOn ? formatCivil(input.dueOn) : null;
    const what = lowerFirst(input.subject.trim());
    const base = dueLabel ? `You committed to ${what} by ${dueLabel}.` : `You committed to ${what}.`;
    if (input.dueOn && input.dueOn < today) return `${base} That date has passed.`;
    if (upcoming >= 3) return `Still open. ${base}`;
    return base;
  }

  if (upcoming >= 4) {
    return `Closing the loop. No reply since ${anchorLabel}.`;
  }
  if (upcoming === 3) {
    return `Two notes have gone unanswered since ${anchorLabel}. Time to change channel.`;
  }

  let base: string;
  if (input.kind === "meeting_request") {
    base =
      upcoming === 2
        ? `Second nudge. You offered times on ${anchorLabel}; still no reply.`
        : `You offered times on ${anchorLabel}; no reply after ${daysLabel(firstOffset)}.`;
  } else if (input.kind === "proposal") {
    const min = window?.min ?? firstOffset;
    const max = window?.max ?? min + 2;
    base =
      upcoming === 2
        ? `Second nudge. You sent the proposal on ${anchorLabel}; still no reply.`
        : `You sent the proposal on ${anchorLabel}; no reply in the ${min}–${max} business day window.`;
  } else if (input.kind === "voicemail") {
    base =
      upcoming === 2
        ? `Second nudge. You left a voicemail on ${anchorLabel}; no callback yet.`
        : `You left a voicemail on ${anchorLabel}; no callback after ${daysLabel(firstOffset)}.`;
  } else if (input.kind === "intro") {
    base =
      upcoming === 2
        ? `Second nudge. You met on ${anchorLabel}; still no reply.`
        : `You met on ${anchorLabel}; no follow-up reply after ${daysLabel(firstOffset)}.`;
  } else if (input.kind === "commitment" && input.direction === "they_owe") {
    const dueLabel = input.dueOn ? ` by ${formatCivil(input.dueOn)}` : "";
    base = `They committed to ${lowerFirst(input.subject)}${dueLabel}.`;
    if (upcoming === 2) base = `Second nudge. ${base}`;
  } else if (input.kind === "check_in") {
    base = `A check-in has been quiet since ${anchorLabel} (${daysLabel(firstOffset)}).`;
    if (upcoming === 2) base = `Second nudge. ${base}`;
  } else {
    base = `No reply since ${anchorLabel} (${daysLabel(firstOffset)}).`;
    if (upcoming === 2) base = `Second nudge. ${base}`;
  }

  return base;
}

export function evidenceUsesHolidayCalendar(config: TimingConfig, iso: string): string | null {
  return holidayMap(config, iso).get(iso) ?? null;
}
