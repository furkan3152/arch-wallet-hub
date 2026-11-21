import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

/**
 * POST /v1/btc/build must build for a P2TR sender. Every Hub-created
 * Turnkey wallet's default address is P2TR, and bitcoinjs-lib needs an
 * ECC backend (initEccLib) before it can encode a Taproot output script.
 */

// BIP-350 testnet P2TR vector.
const P2TR = "tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c";
const RESOURCE_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  utxos: [] as Array<{ txid: string; vout: number; value: number }>,
  address: "",
}));

vi.mock("../../db/pool.js", () => ({ getDbPool: () => ({}) }));
vi.mock("../../db/tx.js", () => ({
  withDbTransaction: async (_pool: unknown, cb: (client: unknown) => Promise<unknown>) => cb({}),
}));
vi.mock("../../db/apps.js", async (orig) => ({
  ...(await orig<typeof import("../../db/apps.js")>()),
  getOrCreateUserByExternalId: async () => ({ id: "user-1" }),
}));
vi.mock("../../db/queries.js", async (orig) => ({
  ...(await orig<typeof import("../../db/queries.js")>()),
  getTurnkeyResourceByIdForApp: async () => ({ id: RESOURCE_ID, user_id: "user-1", default_address: mocks.address }),
}));
vi.mock("../../indexer/forRequest.js", async (orig) => ({
  ...(await orig<typeof import("../../indexer/forRequest.js")>()),
  indexerForRequest: () => ({
    getBtcAddressUtxos: async () => mocks.utxos,
    getBtcFeeEstimates: async () => ({}),
  }),
}));

import { registerSessionAuth } from "../../plugins/sessionAuth.js";
import { registerBtcTransactionRoutes } from "../btcTransactions.js";

async function buildServer() {
  const app = Fastify();
  app.decorate("config", { SESSION_ENFORCED_ROUTES: "" } as never);
  app.addHook("onRequest", async (request) => {
    (request as any).app = { appId: "app", apiKeyId: "key", apiKeyPrefix: "p" };
  });
  await app.register(sensible);
  await app.register(registerSessionAuth);
  await app.register(registerBtcTransactionRoutes, { prefix: "/v1" });
  await app.ready();
  return app;
}

async function build(address: string, utxoValues: number[], amountSats: number, feeRate: number) {
  mocks.address = address;
  mocks.utxos = utxoValues.map((value, i) => ({ txid: String(i + 1).repeat(64).slice(0, 64), vout: 0, value }));
  const app = await buildServer();
  const res = await app.inject({
    method: "POST",
    url: "/v1/btc/build",
    payload: { externalUserId: "u", turnkeyResourceId: RESOURCE_ID, toAddress: address, amountSats, feeRate },
  });
  await app.close();
  return res;
}

describe("POST /v1/btc/build P2TR", () => {
  it("builds an unsigned PSBT for a P2TR (Hub default) wallet", async () => {
    const res = await build(P2TR, [50_000], 10_000, 5);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().inputCount).toBe(1);
  });
});
