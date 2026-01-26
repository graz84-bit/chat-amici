import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const TABLE = "securemov";
const JOIN_CODE = import.meta.env.VITE_JOIN_CODE || "";

export default function App() {
  const [nome, setNome] = useState(localStorage.getItem("username") || "");
  const [codice, setCodice] = useState(localStorage.getItem("join_code") || "");
  const [autorizzato, setAutorizzato] = useState(
    localStorage.getItem("autorizzato") === "1"
  );

  const [testo, setTesto] = useState("");
  const [msgs, setMsgs] = useState([]); // ✅ FIX
  const bottomRef = useRef(null);
  const listRef = useRef(null);
  const [isNearBottom, setIsNearBottom] = useState(true);

  const CHAT_TITLE = "SecureMov Chat";

  function entra() {
    const n = nome.trim();
    const c = codice.trim();

    if (n.length < 2) return alert("Inserisci il tuo nome (min 2 lettere).");
    if (!c) return alert("Inserisci il codice chat.");
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

  async function invia() {
    const n = nome.trim();
    const t = testo.trim();

    if (n.length < 2) return alert("Inserisci il tuo nome (min 2 lettere).");
    if (!t) return;

    const { error } = await supabase.from(TABLE).insert({ username: n, testo: t });

    if (error) {
      console.error(error);
      alert("Errore invio: " + error.message);
      return;
    }

    setTesto("");
    await carica(); // fallback
  }

  useEffect(() => {
    document.title = CHAT_TITLE;
  }, []);

  useEffect(() => {
    localStorage.setItem("username", nome);
  }, [nome]);

  useEffect(() => {
    if (!autorizzato) return;

    carica();

    const channel = supabase
      .channel("chat-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: TABLE },
        (payload) => setMsgs((prev) => [...prev, payload.new])
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [autorizzato]);

  useEffect(() => {
    if (isNearBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length, isNearBottom]);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    const threshold = 90;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setIsNearBottom(near);
  }

  const myName = useMemo(() => nome.trim().toLowerCase(), [nome]);

  function fmtTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  // LOGIN
  if (!autorizzato) {
    return (
      <>
        <style>{`
          html, body, #root { height: 100%; margin: 0; background: #0b1220; }
        `}</style>

        <div style={styles.page}>
          <div style={styles.loginWrap}>
            <div style={styles.loginHeader}>
              <div style={styles.hTitle}>{CHAT_TITLE}</div>
              <div style={styles.hSub}>Inserisci nome e codice per entrare</div>
            </div>

            <div style={styles.loginBody}>
              <div style={styles.field}>
                <label style={styles.label}>Nome</label>
                <input
                  style={styles.input}
                  placeholder="Il tuo nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Codice chat</label>
                <input
                  style={styles.input}
                  placeholder="Codice chat"
                  value={codice}
                  onChange={(e) => setCodice(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && entra()}
                />
              </div>

              <button style={styles.primaryBtn} onClick={entra}>
                Entra
              </button>

              <div style={styles.helper}>(Accesso semplice per amici. Non è un login.)</div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // CHAT
  return (
    <>
      <style>{`
        html, body, #root { height: 100%; margin: 0; background: #0b1220; }
      `}</style>

      <div style={styles.page}>
        <div style={styles.header}>
          <div>
            <div style={styles.hTitle}>{CHAT_TITLE}</div>
            <div style={styles.hSub}>{msgs.length} messaggi</div>
          </div>

          <div style={styles.headerRight}>
            <div style={styles.meWrap}>
              <span style={styles.meLabel}>Tu:</span>
              <input
                style={styles.meInput}
                placeholder="Il tuo nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>
            <button style={styles.ghostBtn} onClick={esci}>
              Esci
            </button>
          </div>
        </div>

        <div style={styles.messagesWrap}>
          <div ref={listRef} onScroll={handleScroll} style={styles.messages}>
            {msgs.map((m) => {
              const mine = (m.username || "").trim().toLowerCase() === myName;
              return (
                <div
                  key={m.id ?? `${m.created_at}-${m.username}-${m.testo}`}
                  style={{ ...styles.row, justifyContent: mine ? "flex-end" : "flex-start" }}
                >
                  <div style={{ ...styles.bubble, ...(mine ? styles.bubbleMine : styles.bubbleOther) }}>
                    {!mine && <div style={styles.username}>{m.username || "?"}</div>}
                    <div style={styles.text}>{m.testo}</div>
                    <div style={styles.meta}>{fmtTime(m.created_at)}</div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </div>

        <div style={styles.composer}>
          <textarea
            style={styles.textarea}
            placeholder="Scrivi un messaggio…"
            value={testo}
            onChange={(e) => setTesto(e.target.value)}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                invia();
              }
            }}
          />
          <button
            style={{ ...styles.sendBtn, ...(testo.trim() ? {} : styles.sendBtnDisabled) }}
            onClick={invia}
            disabled={!testo.trim()}
          >
            Invia
          </button>
        </div>
      </div>
    </>
  );
}

const styles = {
  page: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#0b1220",
    color: "#e8eefc",
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial',
  },

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 16px",
    background: "rgba(255,255,255,0.06)",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    backdropFilter: "blur(10px)",
  },
  hTitle: { fontSize: 18, fontWeight: 800, letterSpacing: 0.2 },
  hSub: { fontSize: 12, opacity: 0.75, marginTop: 2 },

  headerRight: { display: "flex", gap: 10, alignItems: "center" },
  meWrap: { display: "flex", gap: 8, alignItems: "center" },
  meLabel: { fontSize: 12, opacity: 0.8 },
  meInput: {
    width: 170,
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.25)",
    color: "#e8eefc",
    outline: "none",
  },
  ghostBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "#e8eefc",
    cursor: "pointer",
    fontWeight: 700,
  },

  messagesWrap: { flex: 1, display: "flex", flexDirection: "column" },
  messages: { flex: 1, overflowY: "auto", padding: "16px 14px 10px" },
  row: { display: "flex", marginBottom: 10 },

  bubble: {
    maxWidth: "min(560px, 86%)",
    padding: "10px 12px",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  bubbleMine: {
    background: "linear-gradient(180deg, rgba(88,160,255,0.26), rgba(88,160,255,0.10))",
    borderTopRightRadius: 8,
  },
  bubbleOther: {
    background: "rgba(255,255,255,0.06)",
    borderTopLeftRadius: 8,
  },
  username: { fontSize: 12, fontWeight: 800, opacity: 0.9, marginBottom: 4 },
  text: { fontSize: 14, lineHeight: 1.35 },
  meta: { marginTop: 6, fontSize: 11, opacity: 0.65, textAlign: "right" },

  composer: {
    display: "flex",
    gap: 10,
    padding: "12px 14px",
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
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.25)",
    color: "#e8eefc",
    outline: "none",
    lineHeight: 1.35,
  },
  sendBtn: {
    padding: "0 16px",
    height: 44,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(88,160,255,0.35)",
    color: "#e8eefc",
    fontWeight: 800,
    cursor: "pointer",
  },
  sendBtnDisabled: { opacity: 0.45, cursor: "not-allowed" },

  loginWrap: {
    width: "min(520px, 92vw)",
    margin: "auto",
    borderRadius: 18,
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
    boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
    backdropFilter: "blur(12px)",
  },
  loginHeader: { padding: 16, borderBottom: "1px solid rgba(255,255,255,0.10)" },
  loginBody: { padding: 16, display: "grid", gap: 12 },
  field: { display: "grid", gap: 6 },
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
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(88,160,255,0.35)",
    color: "#e8eefc",
    cursor: "pointer",
    fontWeight: 900,
  },
  helper: { fontSize: 12, opacity: 0.65 },
};

