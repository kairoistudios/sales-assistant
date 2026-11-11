import type { AutonomyLevel } from "./types";

export function customerSendAllowed(input: {
  autonomy: AutonomyLevel;
  autoSendEnabled: boolean;
  hasExplicitApproval: boolean;
}): { allowed: boolean; reason: string } {
  if (input.hasExplicitApproval) return { allowed: true, reason: "seller_approved" };
  if (input.autonomy === "auto_send" && input.autoSendEnabled) {
    return { allowed: true, reason: "auto_send" };
  }
  if (input.autonomy === "suggest_only") return { allowed: false, reason: "suggest_only" };
  return { allowed: false, reason: "auto_send_disabled" };
}

export function externalCrmWriteAllowed(input: {
  autonomy: AutonomyLevel;
  hasExplicitApproval: boolean;
  dryRun: boolean;
  connected: boolean;
}): { write: boolean; reason: string } {
  if (!input.connected) return { write: false, reason: "local_ledger" };
  if (input.dryRun) return { write: false, reason: "dry_run" };
  if (input.autonomy === "auto_log" || input.autonomy === "auto_send") {
    return { write: true, reason: "auto_log" };
  }
  if (input.hasExplicitApproval) return { write: true, reason: "approved_with_action" };
  return { write: false, reason: "suggest_only" };
}
