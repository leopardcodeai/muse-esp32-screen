// remotelog.test.js: the page log reaches HA's logbook in order, within its rate limit,
// and waits while HA is away.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RemoteLog, LIMIT_PER_MINUTE, scrub } from "../remotelog.js";

function make() {
  const clock = { t: 1000000 };
  const sent = [];
  let fail = false;
  const log = new RemoteLog({
    name: "Muse Web tab",
    now: () => clock.t,
    send: async (name, message) => { if (fail) throw new Error("down"); sent.push([name, message]); },
  });
  return { log, clock, sent, setFail: (v) => { fail = v; } };
}

test("lines go out in order under the panel name", async () => {
  const { log, sent } = make();
  log.line("a");
  log.line("b");
  assert.equal(await log.flush(true), 2);
  assert.deepEqual(sent, [["Muse Web tab", "a"], ["Muse Web tab", "b"]]);
});

test("nothing leaves while HA is not connected, and nothing is lost", async () => {
  const { log, sent } = make();
  log.line("a");
  assert.equal(await log.flush(false), 0);
  assert.equal(await log.flush(true), 1);
  assert.equal(sent.length, 1);
});

test("a failed send keeps the line for the next flush", async () => {
  const { log, sent, setFail } = make();
  log.line("a");
  setFail(true);
  assert.equal(await log.flush(true), 0);
  setFail(false);
  assert.equal(await log.flush(true), 1);
  assert.deepEqual(sent, [["Muse Web tab", "a"]]);
});

test("a loop is capped per minute and the gap is reported", async () => {
  const { log, clock, sent } = make();
  for (let i = 0; i < LIMIT_PER_MINUTE + 5; i++) log.line("x" + i);
  await log.flush(true);
  assert.equal(sent.length, LIMIT_PER_MINUTE);
  clock.t += 61000;
  log.line("after");
  await log.flush(true);
  assert.equal(sent.at(-1)[1], "(5 Zeilen ausgelassen) after");
});

test("no token or URL query leaves in a log line", () => {
  assert.equal(scrub("load https://h:8322/?token=abc&x=1 failed"), "load https://h:8322/?… failed");
  assert.equal(scrub("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc"), "Bearer …");
  assert.equal(scrub("x access_token=zzz y"), "x access_token=… y");
  assert.equal(scrub("plain"), "plain");
});
