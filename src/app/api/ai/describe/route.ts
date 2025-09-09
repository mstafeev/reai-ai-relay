import { NextRequest, NextResponse } from "next/server";

type Body = {
  title?: string; rooms?: number; area?: number; address?: string; notes?: string;
  price?: number | string; images?: string[]; style?: "both" | "business" | "emotional";
};

function genBusiness(b: Body) {
  const t = b.title?.trim() || "Квартира";
  const rooms = b.rooms ? `${b.rooms}-комнатная` : "Жильё";
  const area = b.area ? `~${b.area} м². ` : "";
  const addr = b.address ? `, ${b.address}` : "";
  return `${rooms} ${t}${addr}. ${area}Панорамные окна, функциональная планировка, аккуратный подъезд. Рядом транспорт и инфраструктура. Готово к показам.`;
}
function genEmotional(b: Body) {
  const t = b.title?.trim() || "уютная квартира";
  const parks = "Парки, кафе и хорошие школы — всё рядом.";
  return `Современный уют — ${t}. Светлая гостиная и тихие спальни, балкон для вечеров. ${parks} Отличный вариант для жизни и инвестиций.`;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const body = (await req.json().catch(() => ({}))) as Body;

  const prompt = `
You are a real-estate copywriter. Create concise Russian descriptions for a property ad.

INPUT:
- Title: ${body.title ?? ""}
- Address: ${body.address ?? ""}
- Price: ${body.price ?? ""}
- Rooms: ${body.rooms ?? ""}
- Area: ${body.area ?? ""}
- Images: ${(body.images || []).join(", ")}
- Notes: ${body.notes ?? ""}

REQUIREMENTS:
- Return STRICT JSON only.
- Keys: "business" (2–4 sentences, facts & benefits), "emotional" (2–4 sentences, lifestyle & vibe).
- Keep it concise, no emojis, no markdown, avoid repeating the title, no made-up facts.
${body.style && body.style !== "both" ? `- Generate only "${body.style}" and set the other key to an empty string.` : ""}
  `.trim();

  // если нет ключа — фолбэк (чтобы сервис не падал)
  if (!apiKey) {
    const business = body.style === "emotional" ? "" : genBusiness(body);
    const emotional = body.style === "business" ? "" : genEmotional(body);
    return NextResponse.json({ ok: true, texts: { business, emotional }, source: "fallback" });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };
  if (process.env.OPENAI_ORG_ID) headers["OpenAI-Organization"] = process.env.OPENAI_ORG_ID!;
  if (process.env.OPENAI_PROJECT_ID) headers["OpenAI-Project"] = process.env.OPENAI_PROJECT_ID!;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You write vivid, precise real-estate copy in Russian. Output JSON only, never prose." },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
      }),
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      const msg = (() => { try { return JSON.parse(errText)?.error?.message || errText; } catch { return errText; } })();
      const business = body.style === "emotional" ? "" : genBusiness(body);
      const emotional = body.style === "business" ? "" : genEmotional(body);
      return NextResponse.json({
        ok: true,
        texts: { business, emotional },
        source: "fallback_llm_error",
        llm_status: r.status,
        llm_error: (msg || "unknown").slice(0, 500),
      });
    }

    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content ?? "{}";
    const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
    const jsonStr = start >= 0 && end > start ? raw.slice(start, end + 1) : "{}";
    let parsed: any = {}; try { parsed = JSON.parse(jsonStr); } catch {}

    const business = body.style !== "emotional" && typeof parsed.business === "string" ? parsed.business.trim() : "";
    const emotional = body.style !== "business" && typeof parsed.emotional === "string" ? parsed.emotional.trim() : "";

    return NextResponse.json({
      ok: true,
      texts: {
        business: business || (body.style === "emotional" ? "" : genBusiness(body)),
        emotional: emotional || (body.style === "business" ? "" : genEmotional(body)),
      },
      source: "llm"
    });
  } catch (e: any) {
    const business = body.style === "emotional" ? "" : genBusiness(body);
    const emotional = body.style === "business" ? "" : genEmotional(body);
    return NextResponse.json({
      ok: true, texts: { business, emotional }, source: "fallback_exception", llm_error: e?.message || "exception"
    });
  }
}
