import type { CrmAdapter, CrmResult } from "./types";

function skipped(reason: string): CrmResult {
  return { ok: true, externalId: null, skipped: true, reason };
}

export class LocalCrm implements CrmAdapter {
  readonly provider = "local" as const;

  async pushClient(): Promise<CrmResult> {
    return skipped("No CRM connected. The ledger is the record.");
  }
  async pushClientContact(): Promise<CrmResult> {
    return skipped("No CRM connected. The ledger is the record.");
  }
  async pushPartnerContact(): Promise<CrmResult> {
    return skipped("No CRM connected. The ledger is the record.");
  }
  async pushOpportunity(): Promise<CrmResult> {
    return skipped("No CRM connected. The ledger is the record.");
  }
  async pushNote(): Promise<CrmResult> {
    return skipped("No CRM connected. The ledger is the record.");
  }
}
