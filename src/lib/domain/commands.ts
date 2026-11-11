import { parseStatedDue } from "./due";

export type CommandType = "approve" | "snooze" | "dismiss" | "not_relevant";

export interface ParsedCommand {
  type: CommandType;
  index: number;
  until?: string;
}

export type CommandParse =
  | { ok: true; actions: ParsedCommand[] }
  | { ok: false; error: string };

function parseClause(clause: string, today: string): { ok: true; actions: ParsedCommand[] } | { ok: false; error: string } {
  const text = clause.trim().toLowerCase();
  if (!text) return { ok: true, actions: [] };

  let type: CommandType | null = null;
  if (/^approve\b/.test(text)) type = "approve";
  else if (/^snooze\b/.test(text)) type = "snooze";
  else if (/^dismiss\b/.test(text)) type = "dismiss";
  else if (/^not relevant\b/.test(text)) type = "not_relevant";
  if (!type) {
    return {
      ok: false,
      error: `I can approve, snooze, dismiss, or mark not relevant. I didn't understand "${clause.trim()}".`,
    };
  }

  let body = text;
  let until: string | undefined;
  if (type === "snooze") {
    const split = text.split(/\buntil\b/);
    if (split.length < 2 || !split[1].trim()) {
      return { ok: false, error: "Snooze needs a date, for example until Friday." };
    }
    body = split[0];
    const when = parseStatedDue(split.slice(1).join("until"), today);
    if (!when) return { ok: false, error: `I couldn't read the date in "${split.slice(1).join("until").trim()}".` };
    until = when;
  }

  const withUntil = (index: number): ParsedCommand => (until ? { type, index, until } : { type, index });

  if (/\ball\b/.test(body)) {
    return { ok: true, actions: [withUntil(0)] };
  }

  const numbers = [...body.matchAll(/\b(\d+)\b/g)].map((match) => Number(match[1]));
  if (numbers.length === 0) return { ok: false, error: "Name the item number, for example approve 1." };
  if (numbers.some((n) => n < 1)) return { ok: false, error: "Item numbers start at 1." };
  return { ok: true, actions: numbers.map((index) => withUntil(index)) };
}

export function parseBriefingCommand(input: string, today: string): CommandParse {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Tell me what to do, for example approve 1 and 3, snooze 2 until Friday." };
  const clauses = trimmed.split(/,|;/).flatMap((part) => part.split(/\band\b(?=\s*(?:approve|snooze|dismiss|not relevant)\b)/));
  const actions: ParsedCommand[] = [];
  for (const clause of clauses) {
    const parsed = parseClause(clause, today);
    if (!parsed.ok) return parsed;
    actions.push(...parsed.actions);
  }
  if (actions.length === 0) return { ok: false, error: "Tell me what to do, for example approve 1." };
  return { ok: true, actions };
}
