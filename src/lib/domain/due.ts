import { addDays, mondayAfterThanksgiving, nextWeekdayOnOrAfter, weekday } from "./timing";

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function upcomingWeekday(today: string, target: number, strictlyAfter: boolean): string {
  const upcoming = nextWeekdayOnOrAfter(today, target);
  if (!strictlyAfter) return upcoming;
  if (upcoming === today) return addDays(today, 7);
  return upcoming;
}

/**
 * Pull a stated follow-up date out of plain text, relative to `today` (a civil date).
 * Returns null when the text does not name a date.
 */
export function parseStatedDue(text: string, today: string): string | null {
  const lower = text.toLowerCase();
  if (/\bafter thanksgiving\b/.test(lower)) return mondayAfterThanksgiving(today);

  const isoMatch = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  const bareWeekday = lower.trim().match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (bareWeekday) return upcomingWeekday(today, WEEKDAYS[bareWeekday[1]], false);

  if (/\btomorrow\b/.test(lower)) return addDays(today, 1);
  if (/\bnext week\b/.test(lower)) {
    const monday = nextWeekdayOnOrAfter(today, 1);
    return monday === today ? addDays(today, 7) : monday;
  }

  const afterWeekday = lower.match(
    /\bafter\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  );
  if (afterWeekday) {
    const target = WEEKDAYS[afterWeekday[1]];
    const day = upcomingWeekday(today, target, weekday(today) === target);
    return addDays(day, 1);
  }

  const nextWeekday = lower.match(
    /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  );
  if (nextWeekday) {
    return upcomingWeekday(today, WEEKDAYS[nextWeekday[1]], true);
  }

  const weekdayMatch = lower.match(
    /\b(?:by|on|before|until|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  );
  if (weekdayMatch) return upcomingWeekday(today, WEEKDAYS[weekdayMatch[1]], false);

  const monthMatch = lower.match(
    /\b(?:by|on|before|until)?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/,
  );
  if (monthMatch) {
    const month = MONTHS[monthMatch[1]];
    const day = Number(monthMatch[2]);
    let year = monthMatch[3] ? Number(monthMatch[3]) : Number(today.slice(0, 4));
    if (!month || day < 1 || day > 31) return null;
    let due = iso(year, month, day);
    if (!monthMatch[3] && due < today) {
      year += 1;
      due = iso(year, month, day);
    }
    return due;
  }

  return null;
}
