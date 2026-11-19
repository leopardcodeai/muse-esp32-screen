// textask.js: a typed question to Muse from the tablet rail, beside push-to-talk (owner,
// 19.11.2026: "rechts auch eine Maske, um Text an Muse zu senden, nicht nur Audio").
//
// The text goes to Home Assistant's `conversation/process` with the Muse agent, the same
// agent the voice pipeline uses, so Muse answers with its usual screen calls; the spoken
// answer text comes back too and is shown as a card when Muse sends none. The conversation id
// is kept, so follow-up questions stay in one conversation. No DOM here (Node tests).

export const DEFAULT_AGENT = "conversation.muse";

export function processRequest(text, opts = {}) {
  const req = { type: "conversation/process", text: String(text).trim(), language: opts.language || "de" };
  req.agent_id = opts.agent || DEFAULT_AGENT;
  if (opts.conversationId) req.conversation_id = opts.conversationId;
  return req;
}

// The answer text and the conversation id of a conversation/process result.
export function answerOf(result) {
  const speech = result && result.response && result.response.speech;
  const text = (speech && ((speech.plain && speech.plain.speech) || (speech.ssml && speech.ssml.speech))) || "";
  return { text: String(text).trim(), conversationId: (result && result.conversation_id) || "" };
}
