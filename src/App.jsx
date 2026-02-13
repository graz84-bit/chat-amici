import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const TABLE = "securemov";
const JOIN_CODE = import.meta.env.VITE_JOIN_CODE || "";

// ====== ANA: documenti “attivi” (opzionale, puoi cambiare) ======
const ANA_DOCS = [
  "Report Ricerca Azienda SecureMov",
  "Report Ricerca Social SecureMov",
];

// ====== Utility: history text (per backend) ======
function fmtForHistory(msgs, max = 30) {
  const tail = (msgs || []).slice(-max);
  return tail
    .map((m) => `${m.username || "?"}: ${(m.testo || "").trim()}`)
    .join("\n");
}

export default function App() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [nome, setNome] = useState(localStorage.getItem("username") || "");
  const [codice, setCodice] = useState(localStorage.getItem("join_code") || "");
  const [autorizzato, setAutorizzato] = useState(
    localStorage.getItem("autorizzato") === "1"
  );
  // ...
}

  const [testo, setTesto] = useState("");
  const [msgs, setMsgs] = useState([]);
  const bottomRef = useRef(null);
  const [sending, setSending] = useState(false);

  const CHAT_TITLE = "Chat SecureMov v3";
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

  // ====== MODIFICATO: Ana con memoria esterna (backend /api/ai) ======
  async function inviaAna(userPrompt, msgsSnapshot) {
    const chatId = (codice || "").trim() || "default";
    const history = fmtForHistory(msgsSnapshot, 30);

    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        user_prompt: userPrompt,
        history,
        docs: ANA_DOCS,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

    const anaText = (data?.text || "").trim();
    if (!anaText) throw new Error("Risposta Ana vuota");

    const { error } = await supabase
      .from(TABLE)
      .insert({ username: "Ana", testo: anaText });

    if (error) throw new Error("DB: " + error.message);
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

        // 1) invia messaggio utente in chat
        await inviaMessaggioNormale(prompt);

        // 2) snapshot: includi anche il messaggio appena inviato (per history coerente)
        const n = nome.trim() || "Utente";
        const msgsSnapshot = [
          ...(msgs || []),
          { username: n, testo: prompt, created_at: new Date().toISOString() },
        ];

       // 3) invia ad Ana (backend gestisce la memoria su Supabase)
await inviaAna(prompt, msgsSnapshot);

return;
}

await inviaMessaggioNormale(t);

} catch (e) {
  console.error(e);
  alert(
    (forceAI ? "Errore Ana: " : "Errore invio: ") +
      (e?.message || "sconosciuto")
  );
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
        const key =
          m?.id ?? `${m?.created_at}-${m?.username}-${m?.testo}`;

        if (seen.has(key)) return;
        seen.add(key);

        setMsgs((prev) => [...prev, m]);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [autorizzato]);

useEffect(() => {
  bottomRef.current?.scrollIntoView({ behavior: "smooth" });
}, [msgs.length]);

useEffect(() => {
  const handler = () => setUpdateAvailable(true);

  window.addEventListener("pwa:update-available", handler);

  return () => {
    window.removeEventListener("pwa:update-available", handler);
  };
}, []);


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
