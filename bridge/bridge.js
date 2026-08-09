"use strict";
// =====================================================================
//  ASRS Digital Twin — OPC UA -> WebSocket bridge   (Phase 2)
//
//  Connects to the S7-1500's built-in OPC UA server as a client,
//  subscribes to the DB_Twin nodes, and re-broadcasts the live crane
//  state as JSON over a WebSocket (~20x/sec). The browser twin and the
//  integrity dashboard consume this stream, never the PLC directly.
//
//  Run:   npm install     (once)
//         npm start
//  Test:  open twin/asrs_twin_3d_standalone.html, or `npx wscat -c ws://localhost:4841`
// =====================================================================

const {
  OPCUAClient, MessageSecurityMode, SecurityPolicy, AttributeIds, TimestampsToReturn,
} = require("node-opcua");
const { WebSocketServer } = require("ws");

const ENDPOINT = process.env.PLC_ENDPOINT || "opc.tcp://192.168.0.1:4840";
const NS = Number(process.env.PLC_NS || 3);   // Siemens DB namespace (UaExpert showed NS3)
const WS_PORT = Number(process.env.WS_PORT || 4841);
const PUBLISH_HZ = 20;

const FIELDS = {
  heartbeat: "Heartbeat", step: "Step", curCell: "CurCell", cycles: "Cycles",
  targetPos: "TargetPos", x_mm: "X_mm", z_mm: "Z_mm", forkExt_mm: "ForkExt_mm",
  lift: "Lift", seq: "Seq",
};
const nodeId = (name) => `ns=${NS};s="DB_Twin"."${name}"`;

const state = { ts: 0 };
for (const k of Object.keys(FIELDS)) state[k] = null;

const wss = new WebSocketServer({ port: WS_PORT });
wss.on("connection", (ws) => {
  console.log(`[ws]  client connected (${wss.clients.size} total)`);
  ws.send(JSON.stringify(state));
  ws.on("close", () => console.log(`[ws]  client left (${wss.clients.size} total)`));
});
function broadcast() {
  const msg = JSON.stringify(state);
  for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(msg);
}
setInterval(broadcast, Math.round(1000 / PUBLISH_HZ));
console.log(`[ws]  WebSocket server listening on ws://localhost:${WS_PORT}`);

const fmt = (v) => (typeof v === "number" ? v.toFixed(0) : v);

async function main() {
  const client = OPCUAClient.create({
    applicationName: "ASRS-Twin-Bridge",
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    endpointMustExist: false,
    connectionStrategy: { maxRetry: -1, initialDelay: 1000, maxDelay: 5000 },
  });
  client.on("backoff", (n, delay) =>
    console.log(`[opc] cannot reach ${ENDPOINT} (try #${n}) — retry in ${delay}ms`));
  client.on("connection_lost", () => console.log("[opc] connection lost — reconnecting…"));
  client.on("connection_reestablished", () => console.log("[opc] reconnected"));

  await client.connect(ENDPOINT);
  console.log(`[opc] connected to ${ENDPOINT}`);
  const session = await client.createSession();
  console.log("[opc] session created (anonymous)");

  const subscription = await session.createSubscription2({
    requestedPublishingInterval: 100, requestedLifetimeCount: 1000,
    requestedMaxKeepAliveCount: 20, maxNotificationsPerPublish: 100,
    publishingEnabled: true, priority: 10,
  });
  console.log("[opc] subscription created");

  for (const key of Object.keys(FIELDS)) {
    const item = await subscription.monitor(
      { nodeId: nodeId(FIELDS[key]), attributeId: AttributeIds.Value },
      { samplingInterval: 50, discardOldest: true, queueSize: 1 },
      TimestampsToReturn.Both
    );
    item.on("changed", (dv) => { state[key] = dv.value.value; state.ts = Date.now(); });
  }
  console.log("[opc] monitoring DB_Twin — streaming live crane state to WebSocket");

  setInterval(() => {
    console.log(`step=${state.step}  cell=${state.curCell}  X=${fmt(state.x_mm)}  ` +
      `Z=${fmt(state.z_mm)}  fork=${fmt(state.forkExt_mm)}  lift=${state.lift}  ` +
      `cycles=${state.cycles}  hb=${state.heartbeat}`);
  }, 1000);

  process.on("SIGINT", async () => {
    console.log("\n[opc] shutting down…");
    try { await subscription.terminate(); await session.close(); await client.disconnect(); } catch (_) {}
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[fatal]", err.message);
  console.error("Check: PLCSIM Advanced 'twin' in RUN, IP/endpoint correct, OPC UA server");
  console.error("enabled (No security / Anonymous). Endpoint:", ENDPOINT);
  process.exit(1);
});
