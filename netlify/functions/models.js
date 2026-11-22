// TEMPORARY diagnostic (delete after use — not part of the site).
// Lists the Gemini models this API key can use, so the chatbot can be
// pointed at a model that actually answers. Returns only model names +
// supported methods. The key itself is never returned or logged.
exports.handler = async () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return { statusCode: 503, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "backend_not_configured" }) };
  }
  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?key=" +
        encodeURIComponent(key) +
        "&pageSize=100",
      { signal: AbortSignal.timeout(8000) }
    );
    const text = await res.text();
    console.log("KELZA models list status:", res.status);
    if (!res.ok) {
      return { statusCode: res.status, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: text.slice(0, 500) }) };
    }
    const data = JSON.parse(text);
    const models = (data.models || []).map((m) => ({
      name: m.name,
      methods: m.supportedGenerationMethods || [],
    }));
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: models.length, models }) };
  } catch (e) {
    return { statusCode: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: String(e && e.message ? e.message : e).slice(0, 200) }) };
  }
};
