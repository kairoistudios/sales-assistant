import type { LoopKind } from "./types";
import { LOOP_KINDS } from "./types";

export type NudgeStageName = "first" | "second" | "channel_change" | "closing";

export interface NudgeStage {
  stage: 1 | 2 | 3 | 4;
  name: NudgeStageName;
  /** Business days after the anchor. Stage 1 is counted from the source (or a stated due date). Later stages are counted from the previous nudge. */
  offsetBusinessDays: number;
  channel: "email" | "phone" | "other";
}

export interface KindTiming {
  stages: NudgeStage[];
  /** For proposals, the silence window the evidence line quotes. First nudge is `min`, second is `max`. */
  windowBusinessDays?: { min: number; max: number };
}

export interface TimingConfig {
  kinds: Record<LoopKind, KindTiming>;
  sendHour: number;
  sendMinute: number;
  fallbackTimeZone: string;
  extraHolidays: string[];
  holidayCalendar: "us-federal" | "none";
}

const STAGES = (
  first: number,
  second: number,
  channel: number,
  closing: number,
  channelName: NudgeStage["channel"] = "phone",
): NudgeStage[] => [
  { stage: 1, name: "first", offsetBusinessDays: first, channel: "email" },
  { stage: 2, name: "second", offsetBusinessDays: second, channel: "email" },
  { stage: 3, name: "channel_change", offsetBusinessDays: channel, channel: channelName },
  { stage: 4, name: "closing", offsetBusinessDays: closing, channel: "email" },
];

export const DEFAULT_TIMING: TimingConfig = {
  sendHour: 9,
  sendMinute: 0,
  fallbackTimeZone: "America/New_York",
  extraHolidays: [],
  holidayCalendar: "us-federal",
  kinds: {
    meeting_request: { stages: STAGES(2, 2, 2, 3) },
    proposal: {
      windowBusinessDays: { min: 3, max: 5 },
      stages: STAGES(3, 2, 2, 3),
    },
    voicemail: { stages: STAGES(2, 2, 2, 3) },
    commitment: { stages: STAGES(0, 1, 1, 2) },
    intro: { stages: STAGES(1, 2, 2, 3) },
    check_in: { stages: STAGES(5, 3, 3, 5) },
    other: { stages: STAGES(2, 2, 2, 3) },
  },
};

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function weekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function civilDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function formatCivil(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

export function formatLongCivil(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

export function zonedTimeToUtc(
  iso: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const [y, m, d] = iso.split("-").map(Number);
  const desired = Date.UTC(y, m - 1, d, hour, minute, 0);
  let utc = desired;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  for (let i = 0; i < 4; i += 1) {
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(utc)).map((part) => [part.type, part.value]),
    );
    let hourValue = Number(parts.hour);
    let dayValue = Number(parts.day);
    let monthValue = Number(parts.month);
    let yearValue = Number(parts.year);
    if (hourValue === 24) {
      hourValue = 0;
      const rolled = addDays(isoDate(yearValue, monthValue, dayValue), 1);
      yearValue = Number(rolled.slice(0, 4));
      monthValue = Number(rolled.slice(5, 7));
      dayValue = Number(rolled.slice(8, 10));
    }
    const asUtc = Date.UTC(yearValue, monthValue - 1, dayValue, hourValue, Number(parts.minute), Number(parts.second));
    const diff = desired - asUtc;
    if (diff === 0) return new Date(utc);
    utc += diff;
  }
  return new Date(utc);
}

function nthWeekdayOfMonth(year: number, month: number, weekdayIndex: number, n: number): string {
  const firstWd = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekdayIndex - firstWd + 7) % 7) + (n - 1) * 7;
  return isoDate(year, month, day);
}

function lastWeekdayOfMonth(year: number, month: number, weekdayIndex: number): string {
  const last = new Date(Date.UTC(year, month, 0));
  const lastDay = last.getUTCDate();
  const lastWd = last.getUTCDay();
  const day = lastDay - ((lastWd - weekdayIndex + 7) % 7);
  return isoDate(year, month, day);
}

function observedFixed(iso: string): string {
  const wd = weekday(iso);
  if (wd === 6) return addDays(iso, -1);
  if (wd === 0) return addDays(iso, 1);
  return iso;
}

export function usFederalHolidays(year: number): Map<string, string> {
  const map = new Map<string, string>();
  const add = (iso: string, name: string) => map.set(iso, name);
  add(observedFixed(`${year}-01-01`), "New Year's Day");
  add(nthWeekdayOfMonth(year, 1, 1, 3), "Martin Luther King Jr. Day");
  add(nthWeekdayOfMonth(year, 2, 1, 3), "Presidents Day");
  add(lastWeekdayOfMonth(year, 5, 1), "Memorial Day");
  add(observedFixed(`${year}-06-19`), "Juneteenth");
  add(observedFixed(`${year}-07-04`), "Independence Day");
  add(nthWeekdayOfMonth(year, 9, 1, 1), "Labor Day");
  add(nthWeekdayOfMonth(year, 10, 1, 2), "Columbus Day");
  add(observedFixed(`${year}-11-11`), "Veterans Day");
  add(nthWeekdayOfMonth(year, 11, 4, 4), "Thanksgiving");
  add(observedFixed(`${year}-12-25`), "Christmas Day");
  return map;
}

export function holidayMap(config: TimingConfig, around: string): Map<string, string> {
  const map = new Map<string, string>();
  if (config.holidayCalendar === "us-federal") {
    const year = Number(around.slice(0, 4));
    for (const y of [year - 1, year, year + 1]) {
      for (const [iso, name] of usFederalHolidays(y)) map.set(iso, name);
    }
  }
  for (const extra of config.extraHolidays) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(extra)) map.set(extra, map.get(extra) ?? "Firm holiday");
  }
  return map;
}

export function isBusinessDay(iso: string, holidays: Map<string, string>): boolean {
  const wd = weekday(iso);
  if (wd === 0 || wd === 6) return false;
  return !holidays.has(iso);
}

export function addBusinessDays(start: string, n: number, holidays: Map<string, string>): string {
  let cursor = start;
  if (n <= 0) {
    while (!isBusinessDay(cursor, holidays)) cursor = addDays(cursor, 1);
    return cursor;
  }
  let left = n;
  while (left > 0) {
    cursor = addDays(cursor, 1);
    if (isBusinessDay(cursor, holidays)) left -= 1;
  }
  return cursor;
}

export function subtractBusinessDays(start: string, n: number, holidays: Map<string, string>): string {
  let cursor = start;
  let left = n;
  while (left > 0) {
    cursor = addDays(cursor, -1);
    if (isBusinessDay(cursor, holidays)) left -= 1;
  }
  return cursor;
}

export function businessDaysBetween(start: string, end: string, holidays: Map<string, string>): number {
  if (end <= start) return 0;
  let count = 0;
  let cursor = start;
  while (cursor < end) {
    cursor = addDays(cursor, 1);
    if (cursor <= end && isBusinessDay(cursor, holidays)) count += 1;
  }
  return count;
}

export function nextWeekdayOnOrAfter(today: string, weekdayIndex: number): string {
  const current = weekday(today);
  const delta = (weekdayIndex - current + 7) % 7;
  return addDays(today, delta);
}

export function thanksgiving(year: number): string {
  return nthWeekdayOfMonth(year, 11, 4, 4);
}

export function mondayAfterThanksgiving(today: string): string {
  const year = Number(today.slice(0, 4));
  let tg = thanksgiving(year);
  if (tg < today) tg = thanksgiving(year + 1);
  return addDays(tg, 4);
}

export interface ScheduleInput {
  kind: LoopKind;
  anchorAt: Date;
  dueOn?: string | null;
  dueIsStated?: boolean;
  nudgeStage: number;
  lastNudgedAt?: Date | null;
  snoozeUntil?: Date | null;
  status: "open" | "closed";
  suppressed?: boolean;
  timeZone: string;
  config: TimingConfig;
  repliedAt?: Date | null;
}

export interface ScheduleResult {
  stopped: boolean;
  stopReason?: "replied" | "closed" | "suppressed" | "sequence_complete";
  nextStage?: NudgeStage;
  nextAt?: Date;
  nextOn?: string;
}

export function scheduleNext(input: ScheduleInput): ScheduleResult {
  if (input.repliedAt) return { stopped: true, stopReason: "replied" };
  if (input.status === "closed") return { stopped: true, stopReason: "closed" };
  if (input.suppressed) return { stopped: true, stopReason: "suppressed" };
  if (input.nudgeStage >= 4) return { stopped: true, stopReason: "sequence_complete" };

  const kindTiming = input.config.kinds[input.kind] ?? input.config.kinds.other;
  const nextStage = kindTiming.stages.find((stage) => stage.stage === input.nudgeStage + 1);
  if (!nextStage) return { stopped: true, stopReason: "sequence_complete" };

  const timeZone = input.timeZone || input.config.fallbackTimeZone;
  const anchorCivil = civilDate(input.anchorAt, timeZone);
  const holidays = holidayMap(input.config, input.dueOn || anchorCivil);

  let baseCivil: string;
  let offset = nextStage.offsetBusinessDays;
  if (input.nudgeStage === 0 && input.dueIsStated && input.dueOn) {
    baseCivil = input.dueOn;
    offset = 0;
  } else if (input.nudgeStage === 0) {
    baseCivil = anchorCivil;
  } else {
    baseCivil = civilDate(input.lastNudgedAt ?? input.anchorAt, timeZone);
  }

  let nextOn = addBusinessDays(baseCivil, offset, holidays);
  let nextAt = zonedTimeToUtc(nextOn, input.config.sendHour, input.config.sendMinute, timeZone);

  if (input.snoozeUntil) {
    let snoozeAt = input.snoozeUntil;
    const snoozeCivil = civilDate(snoozeAt, timeZone);
    const snoozeHolidays = holidayMap(input.config, snoozeCivil);
    if (!isBusinessDay(snoozeCivil, snoozeHolidays)) {
      const rolled = addBusinessDays(snoozeCivil, 0, snoozeHolidays);
      snoozeAt = zonedTimeToUtc(rolled, input.config.sendHour, input.config.sendMinute, timeZone);
    }
    if (snoozeAt > nextAt) {
      nextAt = snoozeAt;
      nextOn = civilDate(nextAt, timeZone);
    }
  }

  return { stopped: false, nextStage, nextAt, nextOn };
}

export function isDueOnOrBefore(nextAt: Date, now: Date, timeZone: string): boolean {
  return civilDate(nextAt, timeZone) <= civilDate(now, timeZone);
}

export function dayContext(now: Date, timeZone: string, config: TimingConfig) {
  const today = civilDate(now, timeZone);
  const holidays = holidayMap(config, today);
  const holiday = holidays.get(today) ?? null;
  const weekend = weekday(today) === 0 || weekday(today) === 6;
  const business = isBusinessDay(today, holidays);
  const nextBusinessDay = business ? today : addBusinessDays(today, 0, holidays);
  return { today, holiday, weekend, business, nextBusinessDay, holidays };
}

function cloneStages(stages: NudgeStage[]): NudgeStage[] {
  return stages.map((stage) => ({ ...stage }));
}

export function cloneTiming(config: TimingConfig = DEFAULT_TIMING): TimingConfig {
  const kinds = {} as TimingConfig["kinds"];
  for (const kind of LOOP_KINDS) {
    const source = config.kinds[kind];
    kinds[kind] = {
      stages: cloneStages(source.stages),
      windowBusinessDays: source.windowBusinessDays ? { ...source.windowBusinessDays } : undefined,
    };
  }
  return {
    sendHour: config.sendHour,
    sendMinute: config.sendMinute,
    fallbackTimeZone: config.fallbackTimeZone,
    extraHolidays: [...config.extraHolidays],
    holidayCalendar: config.holidayCalendar,
    kinds,
  };
}

export function parseTimingConfig(raw: unknown): TimingConfig {
  const config = cloneTiming(DEFAULT_TIMING);
  if (!raw || typeof raw !== "object") return config;
  const value = raw as Record<string, unknown>;
  if (typeof value.sendHour === "number" && value.sendHour >= 0 && value.sendHour <= 23) {
    config.sendHour = Math.floor(value.sendHour);
  }
  if (typeof value.sendMinute === "number" && value.sendMinute >= 0 && value.sendMinute <= 59) {
    config.sendMinute = Math.floor(value.sendMinute);
  }
  if (typeof value.fallbackTimeZone === "string" && value.fallbackTimeZone) {
    config.fallbackTimeZone = value.fallbackTimeZone;
  }
  if (value.holidayCalendar === "none" || value.holidayCalendar === "us-federal") {
    config.holidayCalendar = value.holidayCalendar;
  }
  if (Array.isArray(value.extraHolidays)) {
    config.extraHolidays = value.extraHolidays.filter(
      (entry): entry is string => typeof entry === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry),
    );
  }
  if (value.kinds && typeof value.kinds === "object") {
    const kinds = value.kinds as Record<string, unknown>;
    for (const kind of LOOP_KINDS) {
      const entry = kinds[kind];
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      if (Array.isArray(record.stages)) {
        for (const stage of record.stages) {
          if (!stage || typeof stage !== "object") continue;
          const candidate = stage as Record<string, unknown>;
          const existing = config.kinds[kind].stages.find((item) => item.stage === candidate.stage);
          if (!existing) continue;
          if (
            typeof candidate.offsetBusinessDays === "number" &&
            candidate.offsetBusinessDays >= 0 &&
            candidate.offsetBusinessDays <= 60
          ) {
            existing.offsetBusinessDays = Math.floor(candidate.offsetBusinessDays);
          }
          if (candidate.channel === "email" || candidate.channel === "phone" || candidate.channel === "other") {
            existing.channel = candidate.channel;
          }
        }
      }
      if (record.windowBusinessDays && typeof record.windowBusinessDays === "object") {
        const window = record.windowBusinessDays as Record<string, unknown>;
        const min = Number(window.min);
        const max = Number(window.max);
        if (Number.isFinite(min) && Number.isFinite(max) && min >= 1 && max >= min && max <= 60) {
          config.kinds[kind].windowBusinessDays = { min, max };
          const first = config.kinds[kind].stages.find((stage) => stage.stage === 1);
          const second = config.kinds[kind].stages.find((stage) => stage.stage === 2);
          if (first) first.offsetBusinessDays = min;
          if (second) second.offsetBusinessDays = Math.max(1, max - min);
        }
      }
    }
  }
  return config;
}

export function setProposalWindow(config: TimingConfig, min: number, max: number): TimingConfig {
  return parseTimingConfig({
    ...config,
    kinds: {
      ...config.kinds,
      proposal: {
        ...config.kinds.proposal,
        windowBusinessDays: { min, max },
      },
    },
  });
}
