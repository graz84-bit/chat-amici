import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const TABLE = "securemov";
const JOIN_CODE = import.meta.env.VITE_JOIN_CODE || "";

// ====== ANA: documenti “attivi” (opzionale, puoi cambiare) ======
const ANA_DOCS = ["Report Ricerca Azienda SecureMov", "Report Ricerca Social SecureMov"];

// ====== Utility: history text (per backend) ======
function fmtForHistory(msgs, max = 30) {
  const tail = (msgs || []).slice(-max);
  return tail
    .map((m) => `${m.username || "?"}: ${(m.testo || "").trim()}`)
    .join("\n");
}

export default function App() {
  // PWA update flag
  const [updateAvailable, setUpdateAvailable] = useState(false);

  // Auth semplice
  const [nome, setNome] = useState(localStorage.getItem("username") || "");
  const [codice, setCodice] = useState(localStorage.getItem("join_code") || "");
  const [autorizzato, setAutorizzato] = useState(localStorage.getItem("autorizzato") === "1");

  // Chat
  const [testo, setTesto] = useState("");
  const [msgs, setMsgs] = useState([]);
  const bottomRef = useRef(null);
  const [sending, setSending] = useState(false);

  // Notifiche (toast semplice)
  const [toast, setToast] = useState("");

  const CHAT_TITLE = "Chat SecureMov v3";
  const myName = useMemo(() => nome.trim().toLowerCase(), [nome]);

  // ====== NOTIFICA (pronta per espansioni) ======
  function notify(message) {
    if (!message) return;

    // 1) Toast in-app
    setToast(message);
    window.clearTimeout(window.__SM_TOAST_T__);
    window.__SM_TOAST_T__ = window.setTimeout(() => setToast(""), 3500);

    // 2) (Opzionale) Notification API (solo se autorizzata)
    // Su Android PWA può funzionare, ma richiede permesso.
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Chat SecureMov", { body: message });
      }
    } catch {
      // ignora
    }
  }

  async function requestNotificationPermission() {
    try {
      if (!("Notification" in window)) return;
      if (Notification.permission === "granted") return;
      if (Notification.permission === "denied") return;

      const res = await Notification.requestPermission();
      if (res === "granted") notify("Notifiche attivate ✅");
    } catch {
      // ignora
    }
  }

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

    // facoltativo: chiedi permesso notifiche al primo ingresso
    // requestNotificationPermission();
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

  // ====== Ana con memoria esterna (backend /api/ai) ======
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

    const { error } = await supabase.from(TABLE).insert({ username: "Ana", testo: anaText });
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

        // 2) snapshot coerente
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
      alert((forceAI ? "Errore Ana: " : "Errore invio: ") + (e?.message || "sconosciuto"));
    } finally {
      setSending(false);
    }
  }

  // ====== realtime supabase ======
  useEffect(() => {
    if (!autorizzato) return;

    carica();
    const seen = new Set();

    const channel = supabase
      .channel("securemov-chat")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: TABLE }, (payload) => {
        const m = payload.new;
        const key = m?.id ?? `${m?.created_at}-${m?.username}-${m?.testo}`;
        if (seen.has(key)) return;
        seen.add(key);

        setMsgs((prev) => [...prev, m]);

        // notifica solo se arriva un messaggio non tuo
        const mine = (m?.username || "").trim().toLowerCase() === myName;
        if (!mine) notify(`${m.username || "?"}: ${(m.testo || "").slice(0, 80)}`);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autorizzato]);

  // autoscroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  // ascolta update PWA
  useEffect(() => {
    const handler = () => {
      setUpdateAvailable(true);
      notify("Nuova versione disponibile. Premi Aggiorna.");
    };

    window.addEventListener("pwa:update-available", handler);
    return () => window.removeEventListener("pwa:update-available", handler);
  }, []);

  // ====== UI login ======
  if (!autorizzato) {
    return (
      <div style={styles.loginPage}>
        <div style={styles.loginCard}>
          <div style={styles.loginTitle}>{CHAT_TITLE}</div>
          <div style={styles.loginSub}>Inserisci nome e codice per entrare</div>

          <div style={styles.field}>
            <label htmlFor="nome" style={styles.label}>
              Nome
            </label>
            <input
              id="nome"
              name="nome"
              style={styles.input}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Il tuo nome"
              autoComplete="name"
              onKeyDown={(e) => e.key === "Enter" && entra()}
            />
          </div>

          <div style={styles.field}>
            <label htmlFor="codice" style={styles.label}>
              Codice chat
            </label>
            <input
              id="codice"
              name="codice"
              style={styles.input}
              value={codice}
              onChange={(e) => setCodice(e.target.value)}
              placeholder="Codice"
              autoComplete="off"
              onKeyDown={(e) => e.key === "Enter" && entra()}
            />
          </div>

          <button style={styles.primaryBtn} onClick={entra}>
            Entra
          </button>

          <button
            style={{ ...styles.ghostBtn, width: "100%", marginTop: 10 }}
            onClick={requestNotificationPermission}
            type="button"
          >
            Attiva notifiche
          </button>

          <div style={styles.helper}>(Accesso semplice per amici. Non è un login.)</div>
        </div>
      </div>
    );
  }

  // ====== UI chat ======
  return (
    <div style={styles.page}>
      {/* Toast */}
      {toast ? (
        <div style={styles.toast} role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}

      <div style={styles.header}>
        <div>
          <div style={styles.hTitle}>{CHAT_TITLE}</div>
          <div style={styles.hSub}>{msgs.length} messaggi</div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {updateAvailable && (
            <button
              style={{
                ...styles.ghostBtn,
                borderColor: "rgba(160,255,180,0.35)",
                background: "rgba(160,255,180,0.10)",
              }}
              onClick={async () => {
                try {
                  const fn = window.__PWA_UPDATE_SW__;
                  if (typeof fn === "function") await fn(true);
                } catch {
                  // ignore
                } finally {
                  window.location.reload();
                }
              }}
              title="Aggiorna alla nuova versione"
              type="button"
            >
              Aggiorna
            </button>
          )}

          <button style={styles.ghostBtn} onClick={esci} type="button">
            Esci
          </button>
        </div>
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
          id="messaggio"
          name="messaggio"
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
          type="button"
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
          type="button"
        >
          Invia
        </button>
      </div>
    </div>
  );
}

// ====== STYLES FUORI DAL COMPONENTE ======
const styles = {
  page: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#0b1220",
    color: "#e8eefc",
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial',
  },

  toast: {
    position: "fixed",
    top: 12,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 9999,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.65)",
    color: "#e8eefc",
    boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
    maxWidth: "min(640px, 92vw)",
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

  chat: { flex: 1, overflowY: "auto", padding: "16px 14px" },

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
    background: "linear-gradient(180deg, rgba(88,160,255,0.22), rgba(88,160,255,0.10))",
    borderTopRightRadius: 8,
  },
  bubbleOther: { background: "rgba(255,255,255,0.06)", borderTopLeftRadius: 8 },
  bubbleAna: {
    background: "linear-gradient(180deg, rgba(160,255,180,0.14), rgba(160,255,180,0.06))",
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
  btnDisabled: { opacity: 0.45, cursor: "not-allowed" },

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
