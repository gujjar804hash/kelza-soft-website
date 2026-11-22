// KELZA SOFT — AI chatbot backend (Netlify Function).
// The API key lives ONLY in the Netlify env var (Site settings -> Environment
// variables -> GEMINI_API_KEY). It is NEVER written in index.html or in this
// file. Set GEMINI_API_KEY in Netlify, then redeploy. Until then this endpoint
// answers 503 with { fallback: true } and the website uses its built-in
// assistant instead — the chat never breaks and the visitor never sees an error.
//
// The frontend sends { messages: [{ role: "user"|"assistant", content }] }
// (it also accepts a single { message: "..." }) and expects { reply: "..." }.
// Model: gemini-3.8-flash on the v1beta API. No build step, no dependencies.

const MODEL = "gemini-3.8-flash";
const API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/" +
  MODEL +
  ":generateContent";
const TIMEOUT_MS = 8000;
const MAX_MESSAGES = 8;
const MAX_TEXT = 1000;

const SITE_CONTEXT = [
  "You are KELZA AI Support, the assistant for KELZA SOFT — a factory-direct",
  "wholesale brand of premium Men's Rexine Slippers in Lahore, Pakistan.",
  "Supply is wholesale only (dealers and retailers, B2B). No prices are ever",
  "listed on the site; wholesale rates and minimum order quantities are",
  "confirmed on WhatsApp at +92 306 4768568.",
  "There are 17 articles (101, 103, 104, 107, 108, 201, 203, 205, 206, 301,",
  "304, 306, 401, 403, 405, 406, 408) in Brown and Black. Hero article: 401.",
  "Featured articles are exactly 108, 401, 206.",
  "Contact: 0306-4768568 (WhatsApp + orders), 0303-4052546 (calls only),",
  "kelzasoft@gmail.com. Location: Taragarh, Shahdara Town, Lahore.",
  "Ordering: pick articles on the Order page, fill the enquiry form (name,",
  "phone, email, colour per article, shop name optional), confirm — a",
  "printable Order Slip is made (no amounts) and a short summary goes to",
  "WhatsApp. Greetings get a SHORT reply (one line), then guide the visitor.",
  "Keep answers short — a few lines at most — and reply in the visitor's",
  "language (English or Roman Urdu). Never invent prices, numbers, or facts.",
].join(" ");

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "POST only.", fallback: true });
    }
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      return json(503, { error: "backend_not_configured", fallback: true });
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return json(400, { error: "bad_request", fallback: true });
    }

    // Accept the frontend's { messages: [{ role, content }] } or a single { message }.
    let turns = [];
    if (Array.isArray(body.messages)) {
      turns = body.messages
        .filter((m) => m && typeof m.content === "string" && m.content.trim())
        .slice(-MAX_MESSAGES)
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: String(m.content).slice(0, MAX_TEXT) }],
        }));
    } else if (typeof body.message === "string" && body.message.trim()) {
      turns = [{ role: "user", parts: [{ text: body.message.trim().slice(0, MAX_TEXT) }] }];
    }
    if (!turns.length) {
      return json(400, { error: "empty_message", fallback: true });
    }

    const res = await fetch(API_URL + "?key=" + encodeURIComponent(key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SITE_CONTEXT }] },
        contents: turns,
        generationConfig: { temperature: 0.4, maxOutputTokens: 350 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      // Log the upstream status + message server-side only (never the URL,
      // which carries the key). The public 502 body stays unchanged.
      let detail = "";
      try {
        detail = await res.text();
      } catch (e) {
        detail = "";
      }
      console.error("KELZA chat upstream error:", res.status, detail.slice(0, 500));
      return json(502, { error: "ai_upstream", fallback: true });
    }
    const data = await res.json();
    const answer = ((data.candidates || [])[0] || {}).content
      ? (data.candidates[0].content.parts || [])
          .map((p) => p.text || "")
          .join("")
          .trim()
      : "";
    if (!answer) {
      return json(502, { error: "ai_empty", fallback: true });
    }
    return json(200, { reply: answer, answer });
  } catch (e) {
    console.error("KELZA chat failed:", String(e && e.message ? e.message : e).slice(0, 300));
    return json(502, { error: "ai_failed", fallback: true });
  }
};
