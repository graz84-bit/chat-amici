import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

// ====== Prompt fisso Ana ======
const ANA_SYSTEM = `
Sei Ana, assistente digitale di SecureMov.
Spieghi documenti, report e verifiche in modo chiaro e semplice.
Non inventi dati. Non fornisci consulenza legale o finanziaria.
Usi solo le informazioni fornite nel contesto.
Se un dato manca, lo dichiari esplicitamente.
Stile: neutro, pratico, frasi brevi.
`.trim();

function buildMemoryPrompt({ summary, docs = [] }) {
  const docsText = docs.length ? docs.map((d) => `- ${d}`).join("\n") : "- (nessuno)";
  const s = (summary || "").trim() || "(nessun riassunto ancora)";

  return `
CONTESTO CHAT (MEMORIA):
Obiettivo: supportare l’utente nella comprensione dei documenti/report SecureMov in modo semplice.

Documenti disponibili:
${docsText}

Riassunto conversazione:
${s}

Regole:
- usare solo dati presenti nel contesto
- non inventare
- se mancano informazioni, dirlo chiaramente
`.trim();
}

function appendSummary(prev, line) {
  const base = (prev || "").trim();
  const lines = base ? base.split("\n") : [];
  lines.push(String(line || "").slice(0, 240));
  return lines.slice(-20).join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // ====== Controllo chiavi ======
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY missing" });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // ====== Input (supporta sia vecchio che nuovo formato) ======
    // Vecchio: { prompt }
    // Nuovo: { chat_id, user_prompt, history, docs }
    const body = req.body || {};

    const promptLegacy = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const chatId = typeof body.chat_id === "string" ? body.chat_id.trim() : "";
    const userPrompt = typeof body.user_prompt === "string" ? body.user_prompt.trim() : "";
    const history = typeof body.history === "string" ? body.history.trim() : "";
    const docs = Array.isArray(body.docs) ? body.docs.map(String) : [];

    // Se arriva il vecchio formato, fai come prima
    if (promptLegacy) {
      const response = await client.responses.create({
        model: "gpt-5",
        input: promptLegacy,
      });

      return res.status(200).json({ text: response.output_text });
    }

    // Nuovo formato: serve chat_id + user_prompt
    if (!chatId) return res.status(400).json({ error: "Missing chat_id" });
    if (!userPrompt) return res.status(400).json({ error: "Missing user_prompt" });

    // ====== Supabase client (solo backend!) ======
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      return res.status(500).json({ error: "SUPABASE_URL missing" });
    }
    if (!supabaseServiceKey) {
      return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY missing" });
    }

    const sb = createClient(supabaseUrl, supabaseServiceKey);

    // ====== 1) Leggi summary dal DB ======
    let summary = "";
    {
      const { data, error } = await sb
        .from("ana_memory")
        .select("summary")
        .eq("chat_id", chatId)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: "Supabase read error", detail: error.message });
      }
      summary = data?.summary || "";
    }

    // ====== 2) Costruisci input completo per Ana ======
    const memory = buildMemoryPrompt({ summary, docs });

    const fullPrompt = `
${ANA_SYSTEM}

${memory}

STORICO RECENTE (chat):
${history || "(nessun messaggio storico)"}

RICHIESTA UTENTE:
${userPrompt}

ISTRUZIONI:
- rispondi in italiano
- frasi brevi
- non inventare dati
- se qualcosa non è disponibile, dillo chiaramente
`.trim();

    // ====== 3) Chiama OpenAI ======
    const response = await client.responses.create({
  model: "gpt-5",
  input: fullPrompt,
});


    const anaText = String(response.output_text || "").trim();
    if (!anaText) {
      return res.status(500).json({ error: "Empty Ana reply" });
    }

    // ====== 4) Aggiorna e salva summary su Supabase ======
    const s1 = appendSummary(summary, `U: ${userPrompt}`);
    const s2 = appendSummary(s1, `A: ${anaText}`);

    {
      const { error } = await sb
        .from("ana_memory")
        .upsert({
          chat_id: chatId,
          summary: s2,
          updated_at: new Date().toISOString(),
        });

      if (error) {
        return res.status(500).json({ error: "Supabase write error", detail: error.message });
      }
    }

    // ====== Risposta come prima ======
    return res.status(200).json({ text: anaText });
  } catch (err) {
    console.error("AI ERROR:", err);
    return res.status(500).json({
      error: err?.message || "AI error",
    });
  }
}

