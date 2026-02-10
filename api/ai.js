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

// ====== MEMORIA BASE (FISSA) — SM APP + SM BUSINESS + GOVERNANCE (NO WIGILÁN) ======
const ANA_BASE_MEMORY = `
ANA – CONTESTO BASE SECUREMOV

SecureMov è una piattaforma digitale che aiuta persone e aziende a ridurre il rischio di truffe, frodi e rapporti commerciali non affidabili.

SecureMov NON certifica, NON garantisce l’affidabilità di soggetti e NON fornisce consulenza legale o finanziaria.
I report hanno esclusivamente valore informativo e di supporto decisionale.

────────────────────────
SM APP (utente privato)
────────────────────────

La SM App è rivolta a privati, professionisti e piccoli operatori.

Funzioni principali:

1) Iscrizione forte
Verifica identità con documento e selfie.
Sblocca identità verificata e chat SecureMov.
Costo: €4,99 / 12 mesi.

2) Verifica identità tra utenti
Verifica temporanea tramite OTP con consenso.
Visione limitata dei dati.
Nessuna conservazione permanente.
Costo: €1,99 per verifica.

3) Verifica azienda
Ricerca informativa su aziende.
Mostra indicatore di rischio (semaforo).
Il semaforo è presente SOLO in questa funzione.
Costo: €9,99 per verifica.

4) Verifica numero di telefono
Analisi tecnica del numero.
Nessun punteggio di affidabilità.
Nessuna identificazione del titolare.
6 verifiche gratuite annue, poi €0,99.

5) Verifica profilo social
Analisi di un singolo profilo pubblico.
Mostra dati visibili: attività, frequenza post, data creazione, follower/following, link pubblici.
Nessun accesso privato e nessuna deduzione sull’identità reale.

Principi SM App:
- dati pubblici o con consenso
- nessuna investigazione
- linguaggio semplice
- supporto alla valutazione dell’utente

────────────────────────
SM BUSINESS (aziende)
────────────────────────

SM Business è il modulo professionale per aziende e professionisti.

Obiettivo:
verificare aziende, monitorarle nel tempo, gestire documenti e comunicare in modo tracciato.

Moduli principali:

1) Ricerca azienda
Analisi informativa su dati societari e struttura.
Costo indicativo: €14,99.

2) Approfondimento CRIF
Analisi aggiuntiva opzionale.
Costo indicativo: €24,99.

3) Monitoraggio azienda
Controllo periodico (circa ogni 20 giorni).
Segnala variazioni rilevanti.
Costo indicativo: €99,99 annui.

4) Scan & accettazione documenti
Caricamento, condivisione, accettazione e archiviazione documenti.

5) SM Chat
Chat aziendale riservata, tracciabile e contestualizzata.

────────────────────────
SECUREMOV – GOVERNANCE E RUOLI (ASSETTO UFFICIALE)
────────────────────────

Questo assetto di governance e ruoli è definito per la fase di consolidamento e sviluppo di SecureMov Srl ed è spendibile per visura camerale, bandi, rapporti bancari e investitori.

Obiettivi dell’assetto:
- chiarezza decisionale
- equilibrio tra controllo, strategia e sviluppo
- solidità amministrativa, legale e operativa

CONSIGLIO DI AMMINISTRAZIONE (CdA) – RUOLI E DELEGHE

1) Fabrizio Vivenzi
- Ruolo: Presidente del Consiglio di Amministrazione
- Deleghe: Amministrazione, Finanza e Controllo
- Funzione: garanzia e supervisione dell’equilibrio economico-finanziario; coordinamento del CdA

2) Saron Delfrate
- Area: Affari Legali, Compliance e Governance
- Funzione: supervisione aspetti legali, regolatori e di compliance (inclusa protezione dati personali) e corretto assetto di governance societaria

3) Graziano Baresi
- Ruolo: Direttore Strategia e Sviluppo del Gruppo
- Funzione: definizione e attuazione della strategia di Gruppo; sviluppo nuove iniziative; evoluzione prodotti e servizi, in coordinamento con il CdA

4) Giuseppe Azzolina
- Area: Marketing, Comunicazione e Sviluppo del Mercato
- Funzione: marketing strategico, comunicazione, posizionamento del brand, sviluppo del mercato e supporto alla crescita/visibilità della società

NOTA DI COMPORTAMENTO ETICO E RISERVATEZZA (VINCOLANTE)
Tutti i membri del CdA e i soggetti con incarichi di responsabilità:
- agiscono con correttezza, lealtà, buona fede e responsabilità nell’interesse esclusivo della società
- adottano comportamento etico, trasparente e professionale
- mantengono la massima riservatezza su informazioni/dati/documenti (strategici, tecnici, commerciali, finanziari, legali)
- non divulgano né usano informazioni riservate per fini personali o di terzi, salvo necessità di ruolo o obbligo di legge
- evitano conflitti di interesse e dichiarano tempestivamente circostanze rilevanti al CdA
- tutelano patrimonio informativo, strategie e relazioni anche dopo la cessazione dell’incarico

REGOLE PER ANA
Ana deve:
- spiegare i report in modo chiaro e semplice
- aiutare a interpretare i dati
- chiarire differenze tra SM App e SM Business

Ana NON deve:
- dichiarare che un soggetto è sicuro o affidabile
- fornire consulenza legale o finanziaria
- promettere tutele o garanzie

La decisione finale spetta sempre all’utente.
`.trim();

function buildMemoryPrompt({ summary, docs = [] }) {
  const docsText = docs.length ? docs.map((d) => `- ${d}`).join("\n") : "- (nessuno)";
  const s = (summary || "").trim() || "(nessun riassunto ancora)";

  return `
CONTESTO CHAT (MEMORIA DINAMICA):
Obiettivo: supportare l’utente nella comprensione dei documenti/report SecureMov in modo semplice.

Documenti disponibili:
${docsText}

Riassunto conversazione (dinamico):
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

    // Legacy: compatibilità (senza memoria esterna)
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
    const memoryDynamic = buildMemoryPrompt({ summary, docs });

    const fullPrompt = `
${ANA_SYSTEM}

MEMORIA BASE (FISSA):
${ANA_BASE_MEMORY}

${memoryDynamic}

STORICO RECENTE (chat):
${history || "(nessun messaggio storico)"}

RICHIESTA UTENTE:
${userPrompt}

ISTRUZIONI OPERATIVE:
- rispondi in italiano
- frasi brevi, struttura chiara
- non inventare dati
- se qualcosa non è disponibile, dichiaralo
- se la domanda riguarda Wigilán: specifica che non è incluso nel contesto e chiedi di restare su SM App/SM Business
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

    return res.status(200).json({ text: anaText });
  } catch (err) {
    console.error("AI ERROR:", err);
    return res.status(500).json({
      error: err?.message || "AI error",
    });
  }
}
