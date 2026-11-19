// textask.test.js: the typed question reaches the Muse agent and keeps its conversation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { processRequest, answerOf, DEFAULT_AGENT } from "../textask.js";

test("a typed question goes to the Muse agent in German", () => {
  assert.deepEqual(processRequest("  Wie wird das Wetter?  "),
    { type: "conversation/process", text: "Wie wird das Wetter?", language: "de", agent_id: DEFAULT_AGENT });
});

test("a follow-up keeps the conversation id", () => {
  assert.equal(processRequest("und morgen?", { conversationId: "abc" }).conversation_id, "abc");
});

test("the answer text and id come out of the result", () => {
  const r = { response: { speech: { plain: { speech: "Sonnig, 12 Grad." } } }, conversation_id: "x1" };
  assert.deepEqual(answerOf(r), { text: "Sonnig, 12 Grad.", conversationId: "x1" });
  assert.deepEqual(answerOf(null), { text: "", conversationId: "" });
});
