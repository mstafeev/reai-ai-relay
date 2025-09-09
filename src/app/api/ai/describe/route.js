import { NextResponse } from "next/server";

// Fallbacks (English)
function genTitle(b) {
  const parts = [];
  if (typeof b.bedrooms === "number") parts.push(`${b.bedrooms} BR`);
  if (typeof b.bathrooms === "number") parts.push(`${b.bathrooms} BA`);
  if (typeof b.area === "number") parts.push(`~${b.area} ft²`);
  const meta = parts.join(" · ");
  const addr = b.address ? ` — ${b.address}` : "";
  const base = meta ? `${meta}` : "Property";
  return `${base}${addr}`;
}
function genBusiness(b) {
  const t = (b.title || "").trim() || genTitle(b);
  const area = b.area ? ` ~${b.area} ft².` : "";
  return `${t}.${area} Functional layout, clean lobby, convenient access to transport and daily amenities. Ready for showings.`;
}
function genEmotional(b) {
  const t = (b.title || "").trim() || "A cozy home";
  return `${t} with bright living areas and quiet bedrooms; balcony/outsides for evenings. Parks, cafes, and good schools nearby. Great for living or investment.`;
}

export async function POST(req) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model  = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const base   = process.env.SOURCE_BASE_URL || "https://reality.na4u.ru";
  const maxN   = Number(process.env.MAX_IMAGE_COUNT || 6);

  const b = (await req.json().catch(() => ({}))) || {};
  b.style     = b.style     || "both";
  b.mode      = b.mode      || "all";
  b.length    = b.length    || "medium";
  b.useImages = b.useImages !== false;

  // absolutize relative /api/uploads/.. URLs
  const absImages = Array.isArray(b.images)
    ? b.images
        .filter(u => typeof u === "string")
        .map(u => (u.startsWith("http") ? u : `${base}${u}`))
        .slice(0, maxN)
    : [];

  const price = b.price == null || b.price === "" ? "" : `\n- Price (USD): ${typeof b.price === "number" ? b.price : String(b.price)}`;
  const beds  = b.bedrooms ? `\n- Bedrooms: ${b.bedrooms}` : "";
  const baths = b.bathrooms ? `\n- Bathrooms: ${b.bathrooms}` : "";
  const area  = b.area ? `\n- Area: ${b.area} ft²` : "";
  const notes = (b.notes || "").trim() ? `\n- Notes: ${String(b.notes).trim()}` : "";

  const modeLine =
    b.mode === "title"        ? `- Generate ONLY "title"; set "business" and "emotional" to empty strings.`
  : b.mode === "descriptions" ? `- Generate ONLY "business" and "emotional"; set "title" to empty string.`
                              : `- Generate all three keys.`;

  const styleLine = b.style && b.style !== "both"
    ? `- For descriptions, generate only "${b.style}" and set the other key to an empty string.`
    : "";

  const lenReq =
    b.length === "long"
      ? `- "business": 5–8 sentences; "emotional": 5–8 sentences.`
      : b.length === "short"
      ? `- "business": 1–2 sentences; "emotional": 1–2 sentences.`
      : `- "business": 2–4 sentences; "emotional": 2–4 sentences.`;

  const imageLine = b.useImages && absImages.length
    ? `- You are given up to ${absImages.length} property photos. Derive factual details from images (finishes, light, view, plan hints). Do NOT hallucinate.`
    : `- No images available; rely only on text.`;

  const prompt = `
You are a real-estate copywriter. Produce high-quality English copy for a property listing.

INPUT:
- Title: ${b.title ?? ""}
- Address: ${b.address ?? ""}${price}${beds}${baths}${area}${notes}

REQUIREMENTS:
- Return STRICT JSON only.
- Keys: "title", "business", "emotional".
- "title": 3–10 words, no emojis/markdown; may include BR/BA/ft²/price if grounded.
${lenReq}
- Be specific, avoid generic fluff; highlight unique, verifiable features only. No invented facts.
${modeLine}
${styleLine}
${imageLine}
`.trim();

  if (!apiKey) {
    const title = genTitle(b);
    const business  = b.mode === "title"        ? "" : (b.style === "emotional" ? "" : genBusiness({ ...b, title }));
    const emotional = b.mode === "title" || b.style === "business" ? "" : genEmotional({ ...b, title });
    return NextResponse.json({ ok: true, title, texts: { business, emotional }, source: "fallback" });
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (process.env.OPENAI_ORG_ID) headers["OpenAI-Organization"] = process.env.OPENAI_ORG_ID;
  if (process.env.OPENAI_PROJECT_ID) headers["OpenAI-Project"] = process.env.OPENAI_PROJECT_ID;

  const parts = [{ type: "text", text: prompt }];
  if (b.useImages && absImages.length) {
    for (const url of absImages) {
      parts.push({ type: "image_url", image_url: { url, detail: "high" } });
    }
  }

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: b.length === "long" ? 900 : b.length === "short" ? 300 : 600,
        messages: [
          { role: "system", content: "You write vivid, precise real-estate copy in English. Output JSON only, never prose." },
          { role: "user", content: parts },
        ],
        temperature: 0.6,
        response_format: { type: "json_object" },
      }),
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      let msg = errText; try { msg = JSON.parse(errText)?.error?.message || errText; } catch {}
      const title = genTitle(b);
      const business  = b.mode === "title"        ? "" : (b.style === "emotional" ? "" : genBusiness({ ...b, title }));
      const emotional = b.mode === "title" || b.style === "business" ? "" : genEmotional({ ...b, title });
      return NextResponse.json({
        ok: true, title, texts: { business, emotional }, source: "fallback_llm_error",
        llm_status: r.status, llm_error: (msg || "unknown").slice(0, 500),
      });
    }

    const data = await r.json();
    const raw  = data?.choices?.[0]?.message?.content ?? "{}";
    const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
    const jsonStr = start >= 0 && end > start ? raw.slice(start, end + 1) : "{}";
    let parsed = {}; try { parsed = JSON.parse(jsonStr); } catch {}

    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const business  = b.mode !== "title" && b.style !== "emotional" && typeof parsed.business === "string" ? parsed.business.trim() : "";
    const emotional = b.mode !== "title" && b.style !== "business" && typeof parsed.emotional === "string" ? parsed.emotional.trim() : "";

    return NextResponse.json({
      ok: true,
      title: title || genTitle(b),
      texts: {
        business: business  || (b.mode === "title"        ? "" : (b.style === "emotional" ? "" : genBusiness({ ...b, title: title || genTitle(b) }))),
        emotional: emotional || (b.mode === "title" || b.style === "business" ? "" : genEmotional({ ...b, title: title || genTitle(b) })),
      },
      source: "llm",
    });
  } catch (e) {
    const title = genTitle(b);
    const business  = b.mode === "title"        ? "" : (b.style === "emotional" ? "" : genBusiness({ ...b, title }));
    const emotional = b.mode === "title" || b.style === "business" ? "" : genEmotional({ ...b, title });
    return NextResponse.json({ ok: true, title, texts: { business, emotional }, source: "fallback_exception", llm_error: e?.message || "exception" });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "reai-ai-relay",
    path: "/api/ai/describe",
    usage: "POST with {title?,address?,price?,images?[],bedrooms?,bathrooms?,area?,style?,mode?,length?,useImages?}",
  });
}
