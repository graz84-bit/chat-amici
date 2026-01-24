import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const TABLE = "securemov";

export default function App() {
  const [nome, setNome] = useState(localStorage.getItem("nome_utente") || "");
  const [testo, setTesto] = useState("");
  const [msgs, setMsgs] = useState([]);
  const bottomRef = useRef(null);

  async function carica() {
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, creato_a, testo, nome_utente")
      .order("creato_a", { ascending: true })
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

    const { error } = await supabase.from(TABLE).insert({
      nome_utente: n,
      testo: t,
    });

    if (error) {
      console.error(error);
      alert("Errore invio: " + error.message);
      return;
    }

    setTesto("");
  }

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    localStorage.setItem("nome_utente", nome);
  }, [nome]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>Chat amici</div>
            <div style={styles.sub}>Supabase realtime</div>
          </div>
          <input
            style={styles.name}
            placeholder="Il tuo nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </div>

        <div style={styles.chat}>
          {msgs.map((m) => {
            const mine =
              (m.nome_utente || "").toLowerCase() === nome.trim().toLowerCase();
            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  justifyContent: mine ? "flex-end" : "flex-start",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    ...styles.bubble,
                    background: mine ? "#e9f5ff" : "white",
                  }}
                >
                  <div style={styles.meta}>
                    <b>{m.nome_utente || "?"}</b>
                    <span style={styles.time}>
                      {m.creato_a
                        ? new Date(m.creato_a).toLocaleTimeString()
                        : ""}
                    </span>
                  </div>
                  <div>{m.testo}</div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div style={styles.footer}>
          <input
            style={styles.input}
            placeholder="Scrivi un messaggio…"
            value={testo}
            onChange={(e) => setTesto(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && invia()}
          />
          <button style={styles.btn} onClick={invia}>
            Invia
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "#f4f5f7",
    fontFamily: "system-ui, sans-serif",
    padding: 16,
  },
  card: {
    width: "min(900px, 100%)",
    height: "min(85vh, 720px)",
    background: "white",
    borderRadius: 16,
    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    padding: 16,
    borderBottom: "1px solid #eee",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  title: { fontWeight: 800, fontSize: 18 },
  sub: { fontSize: 12, opacity: 0.6 },
  name: {
    width: 220,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
  },
  chat: { flex: 1, padding: 16, overflowY: "auto", background: "#fafafa" },
  bubble: {
    maxWidth: "70%",
    padding: 12,
    borderRadius: 14,
    border: "1px solid #eee",
  },
  meta: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    fontSize: 12,
    opacity: 0.75,
    marginBottom: 6,
  },
  time: { fontSize: 11, opacity: 0.8 },
  footer: { padding: 12, borderTop: "1px solid #eee", display: "flex", gap: 10 },
  input: {
    flex: 1,
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid #ddd",
  },
  btn: {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid #ddd",
    background: "white",
    cursor: "pointer",
    fontWeight: 700,
  },
};
