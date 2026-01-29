import { useEffect, useRef, useState } from "react";
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
  const [msgs, setMsgs] = useState([]);
  const bottomRef = useRef(null);

  const CHAT_TITLE = "SecureMov Chat";

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

  async function invia() {
    const n = nome.trim();
    const t = testo.trim();
    if (!t) return;

    if (t.toLowerCase().startsWith("/ai ")) {
      const prompt = t.slice(4).trim();
      if (!prompt) return;

      setTesto("");

      try {
        const res = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }

        const aiText = (data?.text || "").trim();
        if (!aiText) {
          throw new Error("Risposta AI vuota");
        }

        const { error } = await supabase.from(TABLE).insert({
          username: "AI",
          testo: aiText,
        });

        if (error) throw new Error("DB: " + error.message);

        await carica();
        return;
      } catch (err) {
        console.error(err);
        alert("Errore AI: " + (err?.message || "sconosciuto"));
        return;
      }
    }

    const { error } = await supabase.from(TABLE).insert({ username: n, testo: t });

    if (error) {
      console.error(error);
      alert("Errore invio: " + error.message);
      return;
    }

    setTesto("");
    await carica();
  }

  useEffect(() => {
    if (!autorizzato) return;

    carica();

    const channel = supabase
      .channel("securemov-chat")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: TABLE },
        (payload) => setMsgs((prev) => [...prev, payload.new])
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
        <div style={styles.loginBox}>
          <h2>{CHAT_TITLE}</h2>
          <input
            style={styles.input}
            placeholder="Nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
          <input
            style={styles.input}
            placeholder="Codice chat"
            value={codice}
            onChange={(e) => setCodice(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && entra()}
          />
          <button style={styles.btn} onClick={entra}>
            Entra
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        {CHAT_TITLE}
        <button style={styles.exit} onClick={esci}>
          Esci
        </button>
      </div>

      <div style={styles.chat}>
        {msgs.map((m) => (
          <div
            key={m.id ?? `${m.created_at}-${m.username}-${m.testo}`}
            style={{
              marginBottom: 8,
              textAlign: (m.username || "").trim() === nome.trim() ? "right" : "left",
            }}
          >
            <b>{m.username}</b>: {m.testo}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={styles.footer}>
        <input
          style={styles.input}
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && invia()}
          placeholder="Scrivi un messaggio o /ai ..."
        />
        <button style={styles.btn} onClick={invia}>
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
    color: "white",
  },
  header: {
    padding: 12,
    borderBottom: "1px solid #333",
  },
  chat: {
    flex: 1,
    padding: 12,
    overflowY: "auto",
  },
  footer: {
    display: "flex",
    gap: 8,
    padding: 12,
    borderTop: "1px solid #333",
  },
  input: {
    flex: 1,
    padding: 10,
  },
  btn: {
    padding: "10px 14px",
  },
  exit: {
    float: "right",
  },
  loginPage: {
    height: "100vh",
    display: "grid",
    placeItems: "center",
    background: "#0b1220",
  },
  loginBox: {
    background: "#111",
    padding: 24,
    borderRadius: 10,
    color: "white",
    display: "grid",
    gap: 10,
    width: 280,
  },
};
