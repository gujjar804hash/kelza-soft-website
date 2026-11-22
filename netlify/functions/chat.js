// KELZA SOFT — AI chatbot backend (Netlify Function).
// The API key lives ONLY in the Netlify env var (Site settings -> Environment
// variables -> GEMINI_API_KEY). It is NEVER written in index.html or in this
// file. Set GEMINI_API_KEY in Netlify, then redeploy. Until then this endpoint
// answers 503 with { fallback: true } and the website uses its built-in
// assistant instead — the chat never breaks and the visitor never sees an error.
//
// The frontend sends { messages: [{ role: "user"|"assistant", content }] }
// (it also accepts a single { message: "..." }) and expects { reply: "..." }.
//
// MODEL RACE — all 5 models are called IN PARALLEL and the first one to
// answer wins. Google's free tier is heavily overloaded on 22 Nov: even the
// best model times out on some calls, but rarely all five at once, so racing
// beats trying them one by one (sequential tries burned the whole 9 s budget
// on two slow models and never reached the rest). Verified 22 Nov via
// models.list (65 models): gemini-2.0-flash is GONE (retired); gemini-2.5-flash
// is listed but generateContent 404s ("no longer available to new users");
// 3.6-flash answered live at 16:42, 3.5-flash at 16:45, while 3.8/3.7-flash
// mostly 503/timeout the same hour. Everything runs inside a 9 s total
// budget (Netlify's own function limit is ~10 s). If every model fails, the
// 502 makes the frontend fall back to its built-in assistant. Model: v1beta
// API. No build step, no dependencies.

const MODELS = [
  "gemini-3.6-flash",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
];
const TOTAL_BUDGET_MS = 9000;
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

function apiUrl(model) {
  return (
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    model +
    ":generateContent"
  );
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

    const payload = JSON.stringify({
      system_instruction: { parts: [{ text: SITE_CONTEXT }] },
      contents: turns,
      generationConfig: { temperature: 0.4, maxOutputTokens: 350 },
    });

    // Race all models in parallel; the first real answer wins. One shared
    // deadline aborts the stragglers. Each failure is logged server-side
    // (never the URL, which carries the key).
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), TOTAL_BUDGET_MS);

    async function tryModel(model) {
      try {
        const res = await fetch(apiUrl(model) + "?key=" + encodeURIComponent(key), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: controller.signal,
        });
        if (!res.ok) {
          let detail = "";
          try {
            detail = await res.text();
          } catch (e) {
            detail = "";
          }
          console.error("KELZA chat upstream error:", model, res.status, detail.slice(0, 500));
          throw new Error("upstream " + res.status);
        }
        const data = await res.json();
        const answer = ((data.candidates || [])[0] || {}).content
          ? (data.candidates[0].content.parts || [])
              .map((p) => p.text || "")
              .join("")
              .trim()
          : "";
        if (!answer) {
          console.error("KELZA chat empty answer:", model);
          throw new Error("empty");
        }
        return { model, answer };
      } catch (e) {
        if (String(e && e.name) !== "AbortError") {
          console.error("KELZA chat failed:", model, String(e && e.message ? e.message : e).slice(0, 300));
        }
        throw e;
      }
    }

    try {
      const winner = await Promise.any(MODELS.map(tryModel));
      clearTimeout(deadline);
      controller.abort();
      console.log("KELZA chat answered via:", winner.model);
      return json(200, { reply: winner.answer, answer: winner.answer });
    } catch (e) {
      clearTimeout(deadline);
      return json(502, { error: "ai_upstream", fallback: true });
    }
  } catch (e) {
    console.error("KELZA chat failed:", String(e && e.message ? e.message : e).slice(0, 300));
    return json(502, { error: "ai_failed", fallback: true });
  }
};
