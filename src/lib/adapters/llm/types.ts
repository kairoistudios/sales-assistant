import type { DraftInput, DraftOutput } from "@/lib/domain/draft";
import type { Extraction, SourceMaterial } from "@/lib/domain/types";

export interface LlmProvider {
  readonly name: string;
  extractMessage(input: {
    source: SourceMaterial;
    sellerEmail: string;
    sellerName: string;
    knownAccountDomains: string[];
    today: string;
    timeZone: string;
  }): Promise<Extraction>;
  extractNote(input: {
    source: SourceMaterial;
    sellerName: string;
    today: string;
    timeZone: string;
  }): Promise<Extraction>;
  extractEvent(input: {
    source: SourceMaterial;
    sellerEmail: string;
    today: string;
    timeZone: string;
  }): Promise<Extraction>;
  draft(input: DraftInput): Promise<DraftOutput>;
}
