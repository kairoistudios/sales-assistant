import { describe, expect, it } from "vitest";
import {
  Turb0PartnersCrm,
  buildClientBody,
  buildClientContactBody,
  buildNoteBody,
  buildOpportunityBody,
  buildPartnerContactBody,
} from "./turb0";

describe("Turb0 Partners payloads", () => {
  it("maps ledger records onto the inferred tables and never calls a real host during dry run", async () => {
    expect(
      buildClientBody({ name: "Helios Logistics", website: "https://helioslogistics.com", isProspect: true }),
    ).toEqual({
      name: "Helios Logistics",
      website: "https://helioslogistics.com",
      is_prospect: true,
    });
    expect(
      buildClientContactBody({
        clientExternalId: "client-1",
        firstName: "Dana",
        lastName: "Okonkwo",
        email: "dana.okonkwo@helioslogistics.com",
        title: "CFO",
      }),
    ).toMatchObject({ client_id: "client-1", first_name: "Dana", title: "CFO" });
    expect(
      buildPartnerContactBody({
        partnerExternalId: "partner-1",
        firstName: "Samir",
        lastName: "Haddad",
        position: "Principal",
      }).position,
    ).toBe("Principal");
    expect(
      buildOpportunityBody({
        name: "Helios finance transformation",
        stage: "proposal",
        valueCents: 42_000_000,
        contractType: "subscription",
        clientExternalId: "client-1",
        clientName: "Helios Logistics",
        createdBy: "user-1",
      }),
    ).toMatchObject({
      stage: "proposal",
      contract_value_usd: 420_000,
      contract_type: "subscription",
      created_by: "user-1",
    });
    expect(buildNoteBody({ opportunityExternalId: "opp-1", body: "Sent the follow-up.", createdBy: "user-1" })).toEqual({
      opportunity_id: "opp-1",
      body: "Sent the follow-up.",
      created_by: "user-1",
    });

    let called = false;
    const dry = new Turb0PartnersCrm({
      supabaseUrl: "http://crm.test",
      anonKey: "anon",
      authMode: "user_jwt",
      accessToken: "seller-jwt",
      dryRun: true,
      fetchImpl: async () => {
        called = true;
        return new Response("[]");
      },
    });
    const skipped = await dry.pushNote({ opportunityExternalId: "opp-1", body: "Note", createdBy: "user-1" });
    expect(skipped.skipped).toBe(true);
    expect(skipped.request?.path).toBe("/rest/v1/opportunity_notes");
    expect(called).toBe(false);
  });

  it("sends the seller token to PostgREST and refuses a note without created_by", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const crm = new Turb0PartnersCrm({
      supabaseUrl: "http://crm.test",
      anonKey: "anon-key",
      authMode: "user_jwt",
      accessToken: "seller-jwt",
      dryRun: false,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), headers: new Headers(init?.headers) });
        return new Response(JSON.stringify([{ id: "note-1" }]), { status: 201 });
      },
    });
    const missing = await crm.pushNote({ opportunityExternalId: "opp-1", body: "Note" });
    expect(missing.ok).toBe(false);
    expect(calls).toHaveLength(0);
    const written = await crm.pushClient({ name: "Helios", website: null, isProspect: false });
    expect(written.externalId).toBe("note-1");
    expect(calls[0].url).toBe("http://crm.test/rest/v1/clients");
    expect(calls[0].headers.get("apikey")).toBe("anon-key");
    expect(calls[0].headers.get("authorization")).toBe("Bearer seller-jwt");
  });
});
