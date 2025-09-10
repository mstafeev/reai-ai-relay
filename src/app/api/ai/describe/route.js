// reai-ai-relay/src/app/api/ai/describe/route.js
import { NextResponse } from "next/server";

// --- Next runtime hints ---
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// === CORS (browser -> Vercel relay) =========================================
const ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || "*"; // можно указать "https://reality.na4u.ru"
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function withCORS(res) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

// === Helpers =================================================================
function json(data, init) {
  return withCORS(NextResponse.json(data, init));
}

function isNonEmpty(s) {
  return typeof s === "string" && s.trim().length > 0;
}

function parsePriceToNumber(price) {
  if (!price) return undefined;
  const num = Number(String(price).replace(/[^\d.]/g, "").replace(",", "."));
  return Number.isFinite(num) ? Math.round(num) : undefined;
}

function featList(bedrooms, bathrooms, area) {
  const parts = [];
  if (typeof bedrooms === "number") parts.push(`${bedrooms} BR`);
  if (typeof bathrooms === "number") parts.push(`${bathrooms} BA`);
  if (typeof area === "number") parts.push(`${area} ft²`);
  return parts.join(" · ");
}

function fallbackTitle(data) {
  const parts = [];
  if (data?.bedrooms) parts.push(`${data.bedrooms}-Bedroom`);
  if (data?.area) parts.push(`${data.area} ft²`);
  const head = parts.length ? parts.join(" ") : "Modern Home";
  const loc = data?.address ? ` in ${data.address}` : "";
  return `${head}${loc}`.slice(0, 120);
}

function fallbackDescriptions(data = {}, length = "medium") {
  const feats = featList(data.bedrooms, data.bathrooms, data.area);
  const priceN = parsePriceToNumber(data.price);
  const priceText =
    typeof priceN === "number"
      ? ` Priced around $${Math.round(priceN).toLocaleString()}.`
      : "";
  const hasImages = Array.isArray(data.images) && data.images.length > 0;
  const imgHint = hasImages
    ? " Photos showcase the space and natural light."
    : "";

  const nBiz = length === "short" ? 2 : length === "long" ? 6 : 4;
  const nEmo = length === "short" ? 2 : length === "long" ? 6 : 4;

  const businessSentences = [];
  businessSentences.push(
    `Turn-key property${data.address ? ` at ${data.address}` : ""} with ${
      feats || "balanced layout"
    }.`
  );
  if (data.area)
    businessSentences.push(
      `Efficient floor plan across ${data.area} square feet with flexible living zones.`
    );
  if (data.bedrooms || data.bathrooms)
    businessSentences.push(
      `Comfortable ${data.bedrooms ?? "—"} bedrooms and ${
        data.bathrooms ?? "—"
      } bathrooms for daily convenience.`
    );
  businessSentences.push(
    `Ready for immediate move-in with straightforward ownership and utilities.${priceText}`
  );
  businessSentences.push(
    `Suitable for personal living or as a steady rental asset.${imgHint}`
  );

  const emotionalSentences = [];
  emotionalSentences.push(
    `Step inside and feel the calm — soft daylight and a welcoming flow set the tone.`
  );
  emotionalSentences.push(
    `Cook, gather, and unwind in spaces that bring people together without feeling crowded.`
  );
  if (data.address)
    emotionalSentences.push(
      `The neighborhood around ${data.address} adds a sense of belonging.`
    );
  if (hasImages)
    emotionalSentences.push(
      `The photos hint at warm evenings and lazy weekends already waiting here.`
    );
  emotionalSentences.push(
    `It’s a place that feels like home from the first minute.`
  );

  const business = businessSentences.slice(0, nBiz).join(" ");
  const emotional = emotionalSentences.slice(0, nEmo).join(" ");
  return { business, emotional };
}

function buildSystemPrompt() {
  return `You are a helpful real-estate copywriter. Output STRICT JSON only. No prose outside JSON. Use concise, clear English. Avoid emojis and fluff.`;
}

function buildUserPrompt(data) {
  const priceN = parsePriceToNumber(data.price);
  const features = {
    address: data.address || null,
    price_usd: priceN ?? null,
    bedrooms: data.bedrooms ?? null,
    bathrooms: data.bathrooms ?? null,
    area_ft2: data.area ?? null,
    images_count: Array.isArray(data.images) ? data.images.length : 0,
  };

  const askTitle = `Generate a succinct listing title (max 90 chars) focusing on the top value prop.`;
  const askDesc = `Generate two short descriptions:
- "business": 2–4 concise sentences with factual selling points (layout, size, condition, area highlights, potential ROI; no emojis);
- "emotional": 2–4 warm sentences evoking comfort and lifestyle (no fluff).`;

  const extra =
    data.length === "short"
      ? "Target ~45–70 words total (about 2–3 sentences per style)."
      : data.length === "long"
      ? "Target ~160–220 words total (about 5–7 sentences per style)."
      : "Target ~90–130 words total (about 3–4 sentences per style).";
  const imgNote = data.useImages
    ? "You may infer general positives from having photos (light, finishes) but never hallucinate specific details."
    : "Do not use any image-based assumptions.";

  return `INPUT:
${JSON.stringify(features)}

TASK:
${askTitle}
${askDesc}

STYLE:
- ${extra}
- ${imgNote}

OUTPUT:
Return a single JSON object:
{
  "title": "string",
  "texts": {
    "business": "string",
    "emotional": "string"
  }
}`;
}

// === OpenAI call =============================================================
async function callOpenAI(data) {
  const apiKey =
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_APIKEY ||
    process.env.OPENAI_KEY;
  if (!apiKey) {
    return { status: "missing_key" };
  }

  try {
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(data) },
        ],
        max_tokens: 400, // ← добавить эту строку
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = j?.error?.message || `HTTP ${res.status}`;
      return { status: "error", error: msg };
    }

    const content = j?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return { status: "error", error: "empty_response" };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { status: "error", error: "bad_json" };
    }

    const title = isNonEmpty(parsed?.title) ? String(parsed.title) : undefined;
    const business = isNonEmpty(parsed?.texts?.business)
      ? String(parsed.texts.business)
      : undefined;
    const emotional = isNonEmpty(parsed?.texts?.emotional)
      ? String(parsed.texts.emotional)
      : undefined;

    return { title, business, emotional, status: "ok" };
  } catch (e) {
    return { status: "error", error: String(e?.message || e) };
  }
}

// === Route handler ===========================================================
export async function POST(req) {
  try {
    const body = (await req.json().catch(() => ({}))) || {};
    const mode = body.mode || "all"; // "title" | "descriptions" | "all"
    const length = body.length || "medium"; // "short" | "medium" | "long"

    const hasKey =
      !!process.env.OPENAI_API_KEY ||
      !!process.env.OPENAI_APIKEY ||
      !!process.env.OPENAI_KEY;

    // 1) Попытка LLM (или пропускаем, если ключа нет)
    const llm = hasKey ? await callOpenAI({ ...body, length }) : { status: "missing_key" };

    // 2) Смешивание с фоллбеком
    let title = (body.title || "").trim();
    let business = "";
    let emotional = "";

    if (isNonEmpty(llm.title)) title = String(llm.title).slice(0, 200);
    if (isNonEmpty(llm.business)) business = String(llm.business);
    if (isNonEmpty(llm.emotional)) emotional = String(llm.emotional);

    const needTitle = mode === "title" || mode === "all";
    const needTexts = mode === "descriptions" || mode === "all";

    if (needTitle && !isNonEmpty(title)) {
      title = fallbackTitle(body);
    }
    if (needTexts && (!isNonEmpty(business) || !isNonEmpty(emotional))) {
      const fb = fallbackDescriptions(body, length);
      if (!isNonEmpty(business)) business = fb.business;
      if (!isNonEmpty(emotional)) emotional = fb.emotional;
    }

    // 3) Формируем ожидаемый фронтом payload
    const payload = {
      ok: true,
      source: llm.status === "ok" ? "openai" : "fallback",
      llm_status: llm.status, // "ok" | "missing_key" | "error"
    };
    if (llm.error) payload.llm_error = llm.error;
    if (!hasKey && !payload.llm_error) {
      payload.llm_error = "MISSING_API_KEY";
    }

    if (mode === "title") {
      payload.title = title;
    } else if (mode === "descriptions") {
      payload.texts = { business, emotional };
    } else {
      payload.title = title;
      payload.texts = { business, emotional };
    }

    return json(payload);
  } catch (e) {
    // Никогда не роняем фронт: отдаём фоллбек
    try {
      const fb = fallbackDescriptions({}, "medium");
      return json({
        ok: true,
        source: "fallback",
        llm_status: "error",
        llm_error: String(e?.message || e),
        title: "Modern Home",
        texts: { business: fb.business, emotional: fb.emotional },
      });
    } catch {
      return json({ ok: false, error: "AI_FATAL" }, { status: 500 });
    }
  }
}
