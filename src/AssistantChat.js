import { useState, useRef, useEffect } from "react";
import { supabase } from "./AuthContext";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";

const GREETING = {
  from: "bot",
  text: "Hi! I'm the delivery assistant. Ask me naturally:\n• \"move 31006 to next Friday\"\n• \"where is 31006\"\n• \"how busy is tomorrow\"\n• \"best date\" — emptiest delivery days\nOr just type an SO number to reschedule it.",
  suggestions: ["best date"],
};

// Floating web chat for scheduling deliveries — same flow as the Telegram
// bot (busy-day gate, emptiness suggestions, OM approval rule) but in-app.
export default function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { if (open) { endRef.current?.scrollIntoView({ behavior: "smooth" }); inputRef.current?.focus(); } }, [msgs, open]);

  const send = async (textArg) => {
    const t = (textArg ?? input).trim();
    if (!t || busy) return;
    setInput("");
    setMsgs(m => [...m, { from: "me", text: t }]);
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const cid = localStorage.getItem("pulseActiveCompanyId");
      const res = await fetch(`${API}/assistant/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data?.session?.access_token || ""}`,
          ...(cid && { "X-Company-ID": cid }),
        },
        body: JSON.stringify({ message: t }),
      });
      const d = await res.json();
      setMsgs(m => [...m, { from: "bot", text: d.reply || d.error || "Something went wrong.", suggestions: d.suggestions || [] }]);
    } catch {
      setMsgs(m => [...m, { from: "bot", text: "Network error — please try again." }]);
    }
    setBusy(false);
  };

  const lastSuggestions = !busy ? (msgs[msgs.length - 1]?.from === "bot" ? msgs[msgs.length - 1].suggestions || [] : []) : [];

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button onClick={() => setOpen(true)} title="Delivery Assistant"
          className="fixed bottom-20 lg:bottom-6 right-4 z-40 w-13 h-13 p-3.5 rounded-full bg-violet-600 text-white text-xl shadow-lg shadow-violet-900/30 hover:bg-violet-700 transition-colors">
          💬
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-16 lg:bottom-6 right-2 sm:right-4 z-40 w-[min(94vw,22rem)] h-[min(70vh,30rem)] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="px-4 py-3 bg-violet-600 text-white flex items-center justify-between">
            <div>
              <p className="text-sm font-bold leading-tight">Delivery Assistant</p>
              <p className="text-xs text-violet-200 leading-tight">Schedule deliveries by chat</p>
            </div>
            <button onClick={() => setOpen(false)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-violet-500 text-violet-100">×</button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-gray-50">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs whitespace-pre-wrap leading-relaxed ${m.from === "me" ? "bg-violet-600 text-white rounded-br-sm" : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm"}`}>
                  {m.text}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-3 py-2">
                  <span className="inline-block w-3.5 h-3.5 border-2 border-gray-200 border-t-violet-600 rounded-full animate-spin align-middle" />
                </div>
              </div>
            )}
            {lastSuggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {lastSuggestions.map(s => (
                  <button key={s} onClick={() => send(s)}
                    className="text-xs px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100">
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="p-2 border-t border-gray-100 bg-white flex gap-2">
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="SO number, date, or 'best date'…"
              className="flex-1 text-sm px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-violet-400" />
            <button onClick={() => send()} disabled={busy || !input.trim()}
              className="px-3.5 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-40">➤</button>
          </div>
        </div>
      )}
    </>
  );
}
