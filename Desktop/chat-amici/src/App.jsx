import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const TABLE = "securemov";
const JOIN_CODE = import.meta.env.VITE_JOIN_CODE || "";

// ====== ANA: configurazione ======
const SUMMARY_KEY = "ana_chat_summary_v1";

// Prompt fisso (identità e regole)
const ANA_SYSTEM = `
Sei Ana, assistente digitale di SecureMov.
Spieghi documenti, report e verifiche in modo chiaro e semplice.
Non inventi dati. Non fornisci consulenza legale o finanziaria.
Usi solo le informazioni fornite nel contesto.
Se un dato manca, lo dichiari esplicitamente.
Stile: neutro, pratico, frasi brevi.
`.trim();

// Se vuoi, qui puoi mettere i nomi dei documenti “attivi” (opzionale)
const ANA_DOCS = [
  "Report Ricerca Azienda SecureMov",
  "Report Ricerca Social SecureMov",
];

// ====== Utility: riassunto ======
function appendSummaryLine(prevSummary, line) {
  const prev = (prevSummary || "").trim();
  const lines = prev ? prev.split("\n") : [];
  lines.push(line.slice(0, 240)); // limita lunghezza riga
  return lines.slice(-20).join("\n"); // tieni max 20 righe
}

function buildMemoryPrompt({ summary, docs }) {
  const docsText = (docs && docs.length)
    ? docs.map((d) => `- ${d}`).join("\n")
    : "- (nessuno)";

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

function usernameToRole(username, myNameLower) {
  const u = (username || "").trim().toLowerCase();
  if (u === "ana") return "assistant";
  if (u === myNameLower) return "user";
  // altri utenti: li trattiamo come "user" (sono messaggi di chat)
  return "user";
}

function buildHistoryText(msgs, myNameLower, max = 30) {
  const tail = (msgs || []).slice(-max);
  return tail
    .map((m) => {
      const role = usernameToRole(m.username, myNameLower);
      const who =
        role === "assistant" ? "Ana" : (m.username || "Utente");
      const text = (m.testo || "").trim();
      return `${who}: ${text}`;
    })
    .join("\n");
}

function buildAnaPrompt({
  userPrompt,
  summary,
  docs,
  msgs,
  myNameLower,
}) {
  const memory = buildMemoryPrompt({ summary, docs });
  const history = buildHistoryText(msgs, myNameLower, 30);

  // Prompt unico compatibile col tuo backend attuale (/api/ai accetta {prompt})
  return `
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
}

export default function App() {
  const [nome, setNome] = useState(localStorage.getItem("username") || "");
  const [codice, setCodice] = useState(localStorage.getItem("join_code") || "");
  const [autorizzato, setAutorizzato] = useState(
    localStorage.getItem("autorizzato") === "1"
  );

  const [testo, setTesto] = useState("");
  const [msgs, setMsgs] = useState([]);
  const bottomRef = useRef(null);
  const [sending, setSending] = useState(false);

  // ====== NUOVO: memoria riassunta per Ana ======
  const [chatSummary, setChatSummary] = useState(
    localStorage.getItem(SUMMARY_KEY) || ""
  );

  useEffect(() => {
    localStorage.setItem(SUMMARY_KEY, chatSummary);
  }, [chatSummary]);

  const CHAT_TITLE = "Chat SecureMov";
  const myName = useMemo(() => nome.trim().toLowerCase(), [nome]);

  function entra() {
    const n = nome.trim();
    const c = codice.trim();

    if (n.length < 2) return alert("Inserisci il tuo nome.");
    if (!c) return alert("Inserisci il codice.");
    if (JOIN_CODE && c !== JOIN_CODE) return alert("Codice errato.");

    localStorage.setItem("username", n);
    localStorage.setItem("join_code", c);
    localStorage.setItem("autorizzato", "1");
    setAutorizzato(true);
  }

  function esci() {
    localStorage.removeItem("autorizzato");
    setAutorizzato(false);
  }

  async function carica() {
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, created_at, testo, username")
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) {
      console.error(error);
      alert("Errore lettura: " + error.message);
      return;
    }

    setMsgs(data || []);
  }

  function fmtTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  async function inviaMessaggioNormale(text) {
    const n = nome.trim();
    if (n.length < 2) return alert("Inserisci il tuo nome.");
    const { error } = await supabase.from(TABLE).insert({ username: n, testo: text });
    if (error) throw new Error(error.message);
  }

  // ====== MODIFICATO: Ana riceve prompt completo (system + memoria + history + user) ======
  async function inviaAna(userPrompt, summarySnapshot, msgsSnapshot) {
    const fullPrompt = buildAnaPrompt({
      userPrompt,
      summary: summarySnapshot,
      docs: ANA_DOCS,
      msgs: msgsSnapshot,
      myNameLower: myName,
    });

    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: fullPrompt }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

    const anaText = (data?.text || "").trim();
    if (!anaText) throw new Error("Risposta Ana vuota");

    const { error } = await supabase
      .from(TABLE)
      .insert({ username: "Ana", testo: anaText });

    if (error) throw new Error("DB: " + error.message);

    return anaText;
  }

  async function invia({ forceAI = false } = {}) {
    const t = testo.trim();
    if (!t || sending) return;

    setSending(true);
    setTesto("");

    try {
      const isCmdAI = t.toLowerCase().startsWith("/ai ");
      const isAna = forceAI || isCmdAI;

      if (isAna) {
        const prompt = isCmdAI ? t.slice(4).trim() : t;
        if (!prompt) return;

        // 1) salva il messaggio utente in chat (come già facevi)
        await inviaMessaggioNormale(prompt);

        // 2) aggiorna subito la memoria (riga utente)
        const n = nome.trim() || "Utente";
        const nextSummaryUser = appendSummaryLine(chatSummary, `U(${n}): ${prompt}`);
        setChatSummary(nextSummaryUser);

        // 3) costruisci uno snapshot messaggi includendo anche il nuovo messaggio utente
        //    (così la history include l'ultima riga appena inviata)
        const msgsSnapshot = [
          ...(msgs || []),
          { username: n, testo: prompt, created_at: new Date().toISOString() },
        ];

        // 4) chiama Ana passando summary e history aggiornati
        const anaReply = await inviaAna(prompt, nextSummaryUser, msgsSnapshot);

        // 5) aggiorna memoria con risposta Ana
        setChatSummary((prev) => appendSummaryLine(prev, `A(Ana): ${anaReply}`));

        return;
      }

      await inviaMessaggioNormale(t);
    } catch (e) {
      console.error(e);
      alert((forceAI ? "Errore Ana: " : "Errore invio: ") + (e?.message || "sconosciuto"));
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (!autorizzato) return;

    carica();

    const seen = new Set();

    const channel = supabase
      .channel("securemov-chat")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: TABLE },
        (payload) => {
          const m = payload.new;
          const key = m?.id ?? `${m?.created_at}-${m?.username}-${m?.testo}`;
          if (seen.has(key)) return;
          seen.add(key);
          setMsgs((prev) => [...prev, m]);
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [autorizzato]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  if (!autorizzato) {
    return (
      <div style={styles.loginPage}>
        <div style={styles.loginCard}>
          <div style={styles.loginTitle}>{CHAT_TITLE}</div>
          <div style={styles.loginSub}>Inserisci nome e codice per entrare</div>

          <div style={styles.field}>
            <div style={styles.label}>Nome</div>
            <input
              style={styles.input}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Il tuo nome"
            />
          </div>

          <div style={styles.field}>
            <div style={styles.label}>Codice chat</div>
            <input
              style={styles.input}
              value={codice}
              onChange={(e) => setCodice(e.target.value)}
              placeholder="Codice"
              onKeyDown={(e) => e.key === "Enter" && entra()}
            />
          </div>

          <button style={styles.primaryBtn} onClick={entra}>
            Entra
          </button>

          <div style={styles.helper}>(Accesso semplice per amici. Non è un login.)</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.hTitle}>{CHAT_TITLE}</div>
          <div style={styles.hSub}>{msgs.length} messaggi</div>
        </div>
        <button style={styles.ghostBtn} onClick={esci}>
          Esci
        </button>
      </div>

      <div style={styles.chat}>
        {msgs.map((m) => {
          const mine = (m.username || "").trim().toLowerCase() === myName;
          const isAna = (m.username || "").trim().toLowerCase() === "ana";

          return (
            <div
              key={m.id ?? `${m.created_at}-${m.username}-${m.testo}`}
              style={{
                display: "flex",
                justifyContent: mine ? "flex-end" : "flex-start",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  ...styles.bubble,
                  ...(mine ? styles.bubbleMine : styles.bubbleOther),
                  ...(isAna ? styles.bubbleAna : {}),
                }}
              >
                <div style={styles.metaRow}>
                  <div style={styles.user}>{m.username || "?"}</div>
                  <div style={styles.time}>{fmtTime(m.created_at)}</div>
                </div>
                <div style={styles.text}>{m.testo}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div style={styles.footer}>
        <textarea
          style={styles.textarea}
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          placeholder="Scrivi un messaggio… (oppure usa /ai ... o premi Ana)"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              invia();
            }
          }}
        />

        <button
          style={{
            ...styles.aiBtn,
            ...(testo.trim() && !sending ? {} : styles.btnDisabled),
          }}
          onClick={() => invia({ forceAI: true })}
          disabled={!testo.trim() || sending}
          title="Invia il testo ad Ana"
        >
          Ana
        </button>

        <button
          style={{
            ...styles.sendBtn,
            ...(testo.trim() && !sending ? {} : styles.btnDisabled),
          }}
          onClick={() => invia()}
          disabled={!testo.trim() || sending}
        >
          Invia
        </button>
      </div>
    </div>
  );
}

const styles = {
  page: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#0b1220",
    color: "#e8eefc",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial',
  },

  header: {
    padding: "14px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(10px)",
  },
  hTitle: { fontSize: 18, fontWeight: 900, letterSpacing: 0.2 },
  hSub: { fontSize: 12, opacity: 0.75, marginTop: 2 },

  chat: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 14px",
  },

  bubble: {
    maxWidth: "min(720px, 86%)",
    padding: "10px 12px",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 10px 28px rgba(0,0,0,0.22)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  bubbleMine: {
    background:
      "linear-gradient(180deg, rgba(88,160,255,0.22), rgba(88,160,255,0.10))",
    borderTopRightRadius: 8,
  },
  bubbleOther: {
    background: "rgba(255,255,255,0.06)",
    borderTopLeftRadius: 8,
  },
  bubbleAna: {
    background:
      "linear-gradient(180deg, rgba(160,255,180,0.14), rgba(160,255,180,0.06))",
  },

  metaRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    marginBottom: 6,
    opacity: 0.85,
  },
  user: { fontSize: 12, fontWeight: 900 },
  time: { fontSize: 11, opacity: 0.7 },
  text: { fontSize: 14, lineHeight: 1.35 },

  footer: {
    padding: "12px 14px",
    display: "flex",
    gap: 10,
    borderTop: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(10px)",
  },
  textarea: {
    flex: 1,
    resize: "none",
    minHeight: 44,
    maxHeight: 140,
    padding: "12px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.25)",
    color: "#e8eefc",
    outline: "none",
  },

  sendBtn: {
    height: 44,
    padding: "0 16px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(88,160,255,0.35)",
    color: "#e8eefc",
    fontWeight: 900,
    cursor: "pointer",
  },
  aiBtn: {
    height: 44,
    padding: "0 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(160,255,180,0.20)",
    color: "#e8eefc",
    fontWeight: 900,
    cursor: "pointer",
  },
  btnDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },

  ghostBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "#e8eefc",
    cursor: "pointer",
    fontWeight: 800,
  },

  loginPage: {
    height: "100vh",
    display: "grid",
    placeItems: "center",
    background: "#0b1220",
    color: "#e8eefc",
  },
  loginCard: {
    width: "min(520px, 92vw)",
    padding: 18,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
    boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
  },
  loginTitle: { fontSize: 20, fontWeight: 900, marginBottom: 4 },
  loginSub: { fontSize: 12, opacity: 0.75, marginBottom: 14 },
  field: { display: "grid", gap: 6, marginBottom: 12 },
  label: { fontSize: 12, opacity: 0.8 },
  input: {
    padding: "12px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.25)",
    color: "#e8eefc",
    outline: "none",
  },
  primaryBtn: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(88,160,255,0.35)",
    color: "#e8eefc",
    cursor: "pointer",
    fontWeight: 900,
  },
  helper: { marginTop: 10, fontSize: 12, opacity: 0.65 },
};
