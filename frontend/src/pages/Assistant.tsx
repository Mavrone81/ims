import { useRef, useState, useEffect } from 'react';
import { api, ApiRequestError } from '../api';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'What items are low on stock?',
  'Summarise this project’s inventory.',
  'What moved the most in the last 30 days?',
  'Which items hold the most value?',
];

export default function Assistant() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || loading) return;
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

  return (
    <>
      <div className="page-head">
        <h2>AI Assistant</h2>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', minHeight: 420, padding: 0 }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.length === 0 && (
            <div className="empty" style={{ margin: 'auto', textAlign: 'center', maxWidth: 460 }}>
              <p style={{ marginBottom: 14 }}>Ask about this project’s inventory — stock levels, reorders, movements and value.</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="btn secondary" style={{ fontSize: 13 }} onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
                background: m.role === 'user' ? 'var(--accent, #2563eb)' : 'var(--surface-2, #f1f5f9)',
                color: m.role === 'user' ? '#fff' : 'inherit',
                borderRadius: 12,
                padding: '10px 14px',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.5,
                fontSize: 14,
              }}
            >
              {m.content}
            </div>
          ))}
          {loading && (
            <div style={{ alignSelf: 'flex-start', color: 'var(--muted, #64748b)', fontSize: 14, padding: '4px 6px' }}>Thinking…</div>
          )}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--border, #e2e8f0)', padding: 12 }}
        >
          <input
            className="field"
            style={{ flex: 1 }}
            placeholder={unavailable ? 'AI assistant not configured' : 'Ask about your inventory…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading || unavailable}
          />
          <button className="btn" type="submit" disabled={loading || unavailable || !input.trim()}>Send</button>
        </form>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted, #64748b)', marginTop: 8 }}>
        Answers are AI-generated from your current project’s data and may be imprecise — verify against Reports for decisions.
      </p>
    </>
  );
}
