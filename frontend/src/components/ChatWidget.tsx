import { useEffect, useRef, useState } from 'react';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = ['What is low on stock?', 'Summarise this project', 'Top items by value'];

// Floating AI assistant available on every screen (bottom-right). Talks to the
// same project-scoped POST /assistant endpoint as the full AI Assistant page.
export default function ChatWidget() {
  const { activeProjectId } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading, open]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    if (!activeProjectId) {
      setMessages((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: 'Please select a project first (top bar), then ask again.' }]);
      setInput('');
      return;
    }
    const history = messages.slice(-8);
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setInput('');
    setLoading(true);
    try {
      const res = await api<{ answer: string }>('/assistant', { method: 'POST', body: { question: q, history } });
      setMessages((m) => [...m, { role: 'assistant', content: res.answer }]);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 503) {
        setUnavailable(true);
        setMessages((m) => [...m, { role: 'assistant', content: 'The AI assistant is not configured on this server yet.' }]);
      } else {
        const msg = e instanceof ApiRequestError ? e.message : 'Something went wrong.';
        setMessages((m) => [...m, { role: 'assistant', content: `Sorry — ${msg}` }]);
      }
    } finally {
      setLoading(false);
    }
  }

  const accent = 'var(--accent, #2563eb)';

  return (
    <>
      {/* Launcher bubble */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close assistant' : 'Open AI assistant'}
        style={{
          position: 'fixed', right: 20, bottom: 20, zIndex: 1000,
          width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: accent, color: '#fff', fontSize: 24, lineHeight: 1,
          boxShadow: '0 6px 20px rgba(0,0,0,.25)',
        }}
      >
        {open ? '×' : '💬'}
      </button>

      {/* Panel */}
      {open && (
        <div
          style={{
            position: 'fixed', right: 20, bottom: 88, zIndex: 1000,
            width: 'min(380px, calc(100vw - 40px))', height: 'min(540px, calc(100vh - 140px))',
            display: 'flex', flexDirection: 'column',
            background: 'var(--surface, #fff)', color: 'inherit',
            border: '1px solid var(--border, #e2e8f0)', borderRadius: 14, overflow: 'hidden',
            boxShadow: '0 12px 40px rgba(0,0,0,.28)',
          }}
        >
          <div style={{ background: accent, color: '#fff', padding: '12px 16px', fontWeight: 600, fontSize: 15 }}>
            AI Assistant
            <div style={{ fontWeight: 400, fontSize: 12, opacity: 0.85 }}>Ask about this project’s inventory</div>
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.length === 0 && (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--muted, #64748b)', fontSize: 13 }}>
                <p style={{ marginBottom: 10 }}>How can I help with your inventory?</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="btn secondary" style={{ fontSize: 12 }} onClick={() => send(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: m.role === 'user' ? accent : 'var(--surface-2, #f1f5f9)',
                  color: m.role === 'user' ? '#fff' : 'inherit',
                  borderRadius: 12, padding: '8px 12px', whiteSpace: 'pre-wrap', lineHeight: 1.5, fontSize: 13.5,
                }}
              >
                {m.content}
              </div>
            ))}
            {loading && <div style={{ alignSelf: 'flex-start', color: 'var(--muted, #64748b)', fontSize: 13 }}>Thinking…</div>}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--border, #e2e8f0)', padding: 10 }}
          >
            <input
              className="field"
              style={{ flex: 1 }}
              placeholder={unavailable ? 'AI not configured' : 'Type a question…'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading || unavailable}
            />
            <button className="btn" type="submit" disabled={loading || unavailable || !input.trim()}>Send</button>
          </form>
        </div>
      )}
    </>
  );
}
