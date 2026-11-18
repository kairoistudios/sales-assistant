import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authCookieOptions } from "@/lib/auth/cookies";
import { getDatabasePath } from "@/lib/db";
import { assertRuntimeConfig, demoModeFromEnv, getConfig } from "./config";

const key = randomBytes(32).toString("base64");

describe("production configuration", () => {
  it("keeps demo mode and dry-run defaults, and turns demo off in production", () => {
    expect(demoModeFromEnv({ NODE_ENV: "development" })).toBe(true);
    expect(demoModeFromEnv({ NODE_ENV: "test" })).toBe(true);
    expect(demoModeFromEnv({ NODE_ENV: "production" })).toBe(false);
    expect(demoModeFromEnv({ NODE_ENV: "production", DEMO_MODE: "true" })).toBe(true);
    expect(demoModeFromEnv({ NODE_ENV: "development", DEMO_MODE: "false" })).toBe(false);

    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      DEMO_MODE: process.env.DEMO_MODE,
      CRM_DRY_RUN: process.env.CRM_DRY_RUN,
      AUTO_SEND_ENABLED: process.env.AUTO_SEND_ENABLED,
    };
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.DEMO_MODE;
    delete process.env.CRM_DRY_RUN;
    delete process.env.AUTO_SEND_ENABLED;
    try {
      const config = getConfig();
      expect(config.demoMode).toBe(false);
      expect(config.crmDryRun).toBe(true);
      expect(config.autoSendEnabled).toBe(false);
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("refuses a production boot until the session secret, encryption key, and https URL are set", () => {
    expect(() => assertRuntimeConfig({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertRuntimeConfig({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).not.toThrow();
    expect(() =>
      assertRuntimeConfig({
        NODE_ENV: "production",
        SESSION_SECRET: "dev-only-change-me",
        TOKEN_ENCRYPTION_KEY: key,
        APP_URL: "https://ledger.example.com",
      }),
    ).toThrow(/SESSION_SECRET/);
    expect(() =>
      assertRuntimeConfig({
        NODE_ENV: "production",
        SESSION_SECRET: "x".repeat(32),
        APP_URL: "https://ledger.example.com",
      }),
    ).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(() =>
      assertRuntimeConfig({
        NODE_ENV: "production",
        SESSION_SECRET: "x".repeat(32),
        TOKEN_ENCRYPTION_KEY: "too-short",
        APP_URL: "https://ledger.example.com",
      }),
    ).toThrow(/32 bytes/);
    expect(() =>
      assertRuntimeConfig({
        NODE_ENV: "production",
        SESSION_SECRET: "x".repeat(32),
        TOKEN_ENCRYPTION_KEY: key,
        APP_URL: "http://ledger.example.com",
      }),
    ).toThrow(/APP_URL/);
    expect(() =>
      assertRuntimeConfig({
        NODE_ENV: "production",
        SESSION_SECRET: "x".repeat(32),
        TOKEN_ENCRYPTION_KEY: key,
        APP_URL: "https://ledger.example.com/",
      }),
    ).toThrow(/APP_URL/);
    expect(() =>
      assertRuntimeConfig({
        NODE_ENV: "production",
        SESSION_SECRET: "x".repeat(32),
        TOKEN_ENCRYPTION_KEY: key,
        APP_URL: "https://ledger.example.com",
      }),
    ).not.toThrow();
  });

  it("stores the database on the Railway volume when DATABASE_PATH is unset", () => {
    const previousDatabase = process.env.DATABASE_PATH;
    const previousVolume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
    delete process.env.DATABASE_PATH;
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/data";
    try {
      expect(getDatabasePath()).toBe("/data/sales-assistant.db");
      process.env.DATABASE_PATH = "/tmp/custom.db";
      expect(getDatabasePath()).toBe("/tmp/custom.db");
    } finally {
      if (previousDatabase === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousDatabase;
      if (previousVolume === undefined) delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
      else process.env.RAILWAY_VOLUME_MOUNT_PATH = previousVolume;
    }
  });

  it("marks the session cookie secure only on https", () => {
    expect(authCookieOptions("https://ledger.example.com", 60).secure).toBe(true);
    expect(authCookieOptions("http://127.0.0.1:43123", 60).secure).toBe(false);
  });

  it("stops the production start command until the required env is set", () => {
    const result = spawnSync(process.execPath, ["scripts/start.mjs"], {
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        NODE_ENV: "production",
        SESSION_SECRET: "",
        TOKEN_ENCRYPTION_KEY: "",
        APP_URL: "http://127.0.0.1:43123",
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to start in production");
    expect(result.stderr).toContain("SESSION_SECRET");
    expect(result.stderr).toContain("TOKEN_ENCRYPTION_KEY");
    expect(result.stderr).toContain("APP_URL");
  });
});
