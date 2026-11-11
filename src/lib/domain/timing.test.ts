import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMING,
  addBusinessDays,
  businessDaysBetween,
  civilDate,
  holidayMap,
  isBusinessDay,
  parseTimingConfig,
  scheduleNext,
  setProposalWindow,
  usFederalHolidays,
  zonedTimeToUtc,
} from "./timing";

const holidays = holidayMap(DEFAULT_TIMING, "2026-11-11");

describe("business days and holidays", () => {
  it("skips weekends", () => {
    expect(isBusinessDay("2026-11-07", holidays)).toBe(false);
    expect(isBusinessDay("2026-11-06", holidays)).toBe(true);
    expect(addBusinessDays("2026-11-06", 1, holidays)).toBe("2026-11-09");
  });

  it("observes US federal holidays, including Veterans Day and the July 4 weekend", () => {
    expect(usFederalHolidays(2026).get("2026-11-11")).toBe("Veterans Day");
    expect(usFederalHolidays(2026).get("2026-07-03")).toBe("Independence Day");
    expect(isBusinessDay("2026-11-11", holidays)).toBe(false);
    expect(isBusinessDay("2026-07-03", holidays)).toBe(false);
    expect(addBusinessDays("2026-11-10", 1, holidays)).toBe("2026-11-12");
    expect(addBusinessDays("2026-07-02", 1, holidays)).toBe("2026-07-06");
  });

  it("counts a meeting request as 2 business days and a proposal window as 3 then 5", () => {
    expect(addBusinessDays("2026-11-03", 2, holidays)).toBe("2026-11-05");
    expect(addBusinessDays("2026-11-03", 3, holidays)).toBe("2026-11-06");
    expect(addBusinessDays(addBusinessDays("2026-11-03", 3, holidays), 2, holidays)).toBe(
      addBusinessDays("2026-11-03", 5, holidays),
    );
    expect(businessDaysBetween("2026-11-03", "2026-11-05", holidays)).toBe(2);
  });

  it("places 9:00 in the contact time zone, including across DST", () => {
    expect(zonedTimeToUtc("2026-11-12", 9, 0, "America/New_York").toISOString()).toBe("2026-11-12T14:00:00.000Z");
    expect(zonedTimeToUtc("2026-11-12", 9, 0, "America/Los_Angeles").toISOString()).toBe("2026-11-12T17:00:00.000Z");
    expect(zonedTimeToUtc("2026-10-15", 9, 0, "America/New_York").toISOString()).toBe("2026-10-15T13:00:00.000Z");
  });
});

describe("scheduleNext", () => {
  const anchor = new Date("2026-11-03T15:00:00.000Z");

  it("nudges a meeting request after 2 business days and stops when they reply", () => {
    const first = scheduleNext({
      kind: "meeting_request",
      anchorAt: anchor,
      nudgeStage: 0,
      status: "open",
      timeZone: "America/New_York",
      config: DEFAULT_TIMING,
    });
    expect(first.stopped).toBe(false);
    expect(first.nextOn).toBe("2026-11-05");
    expect(first.nextAt?.toISOString()).toBe("2026-11-05T14:00:00.000Z");
    expect(first.nextStage?.name).toBe("first");

    const stopped = scheduleNext({
      kind: "meeting_request",
      anchorAt: anchor,
      nudgeStage: 1,
      lastNudgedAt: first.nextAt,
      status: "open",
      timeZone: "America/New_York",
      config: DEFAULT_TIMING,
      repliedAt: new Date("2026-11-05T16:00:00.000Z"),
    });
    expect(stopped).toEqual({ stopped: true, stopReason: "replied" });
  });

  it("uses the contact time zone when the civil date differs from the seller", () => {
    const instant = new Date("2026-11-04T05:30:00.000Z");
    expect(civilDate(instant, "America/Los_Angeles")).toBe("2026-11-03");
    expect(civilDate(instant, "America/New_York")).toBe("2026-11-04");
    const west = scheduleNext({
      kind: "meeting_request",
      anchorAt: instant,
      nudgeStage: 0,
      status: "open",
      timeZone: "America/Los_Angeles",
      config: DEFAULT_TIMING,
    });
    const east = scheduleNext({
      kind: "meeting_request",
      anchorAt: instant,
      nudgeStage: 0,
      status: "open",
      timeZone: "America/New_York",
      config: DEFAULT_TIMING,
    });
    expect(west.nextOn).toBe("2026-11-05");
    expect(east.nextOn).toBe("2026-11-06");
  });

  it("escalates a proposal from day 3 to day 5, then changes channel, then closes", () => {
    const first = scheduleNext({
      kind: "proposal",
      anchorAt: anchor,
      nudgeStage: 0,
      status: "open",
      timeZone: "America/New_York",
      config: DEFAULT_TIMING,
    });
    expect(first.nextOn).toBe("2026-11-06");
    const second = scheduleNext({
      kind: "proposal",
      anchorAt: anchor,
      nudgeStage: 1,
      lastNudgedAt: first.nextAt,
      status: "open",
      timeZone: "America/New_York",
      config: DEFAULT_TIMING,
    });
    expect(second.nextOn).toBe("2026-11-10");
    expect(second.nextStage?.name).toBe("second");
    const channel = scheduleNext({
      kind: "proposal",
      anchorAt: anchor,
      nudgeStage: 2,
      lastNudgedAt: second.nextAt,
      status: "open",
      timeZone: "America/New_York",
      config: DEFAULT_TIMING,
    });
    expect(channel.nextStage?.channel).toBe("phone");
    const closing = scheduleNext({
      kind: "proposal",
      anchorAt: anchor,
      nudgeStage: 3,
      lastNudgedAt: channel.nextAt,
      status: "open",
      timeZone: "America/New_York",
      config: DEFAULT_TIMING,
    });
    expect(closing.nextStage?.name).toBe("closing");
    const done = scheduleNext({
      kind: "proposal",
      anchorAt: anchor,
      nudgeStage: 4,
      status: "open",
      timeZone: "America/New_York",
      config: DEFAULT_TIMING,
    });
    expect(done.stopReason).toBe("sequence_complete");
  });

  it("stops when the loop is closed and rolls a weekend snooze to the next business morning", () => {
    const closed = scheduleNext({
      kind: "voicemail",
      anchorAt: anchor,
      nudgeStage: 0,
      status: "closed",
      timeZone: "America/New_York",
      config: DEFAULT_TIMING,
    });
    expect(closed.stopReason).toBe("closed");

    const snoozed = scheduleNext({
      kind: "voicemail",
      anchorAt: anchor,
      nudgeStage: 0,
      status: "open",
      timeZone: "America/New_York",
      config: DEFAULT_TIMING,
      snoozeUntil: new Date("2026-11-08T15:00:00.000Z"),
    });
    expect(snoozed.nextOn).toBe("2026-11-09");
    expect(snoozed.nextAt?.toISOString()).toBe("2026-11-09T14:00:00.000Z");
  });

  it("honors a stated due date and a configured proposal window", () => {
    const stated = scheduleNext({
      kind: "commitment",
      anchorAt: anchor,
      dueOn: "2026-11-13",
      dueIsStated: true,
      nudgeStage: 0,
      status: "open",
      timeZone: "America/New_York",
      config: DEFAULT_TIMING,
    });
    expect(stated.nextOn).toBe("2026-11-13");

    const configured = setProposalWindow(parseTimingConfig({}), 4, 7);
    expect(configured.kinds.proposal.windowBusinessDays).toEqual({ min: 4, max: 7 });
    const scheduled = scheduleNext({
      kind: "proposal",
      anchorAt: anchor,
      nudgeStage: 0,
      status: "open",
      timeZone: "America/New_York",
      config: configured,
    });
    expect(scheduled.nextOn).toBe(addBusinessDays("2026-11-03", 4, holidays));
  });
});
