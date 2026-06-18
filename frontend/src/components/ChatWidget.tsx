import { useEffect, useRef, useState } from 'react';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';
import { Markdown } from './Markdown';

interface Attachment {
  media_type: string;
  data: string; // base64, no data: prefix
  preview: string; // data URL for thumbnail
}
interface Msg {
  role: 'user' | 'assistant';
  content: string;
  images?: string[]; // preview URLs to render
}

const SUGGESTIONS = ['What is low on stock?', 'Summarise this project', 'Top items by value'];

// Downscale an image file to <=1280px and re-encode as JPEG so uploads stay small.
function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const max = 1280;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no canvas'));
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve({ media_type: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// Floating AI assistant available on every screen (bottom-right). Talks to the
// project-scoped POST /assistant endpoint (tool-backed DB access + image vision).
export default function ChatWidget() {
  const { activeProjectId } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading, open]);

  async function addFiles(files: FileList | File[]) {
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    const next: Attachment[] = [];
    for (const f of imgs.slice(0, 4 - attachments.length)) {
      try { next.push(await fileToAttachment(f)); } catch { /* skip bad image */ }
    }
    if (next.length) setAttachments((a) => [...a, ...next].slice(0, 4));
  }

  async function send() {
    const q = input.trim();
    if ((!q && attachments.length === 0) || loading) return;
    if (!activeProjectId) {
      setMessages((m) => [...m, { role: 'user', content: q || '(image)', images: attachments.map((a) => a.preview) },
        { role: 'assistant', content: 'Please select a project first (top bar), then ask again.' }]);
      setInput(''); setAttachments([]);
      return;
    }
    const imgs = attachments;
    const history = messages.filter((m) => m.content).slice(-8).map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: q, images: imgs.map((a) => a.preview) }]);
    setInput(''); setAttachments([]); setLoading(true);
    try {
      const res = await api<{ answer: string }>('/assistant', {
        method: 'POST',
        body: { question: q, history, images: imgs.map((a) => ({ media_type: a.media_type, data: a.data })) },
      });
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

  const accent = 'var(--primary, #1e5eff)';
  const brandGradient = 'linear-gradient(135deg, var(--primary, #1e5eff), var(--primary-dark, #1546c0))';
  const canSend = !loading && !unavailable && (!!input.trim() || attachments.length > 0);

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close assistant' : 'Open AI assistant'}
        style={{
          position: 'fixed', right: 20, bottom: 20, zIndex: 1000,
          width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: brandGradient, color: '#fff', fontSize: 24, lineHeight: 1,
          boxShadow: '0 6px 20px rgba(30,94,255,.35)',
        }}
      >
        {open ? '×' : '💬'}
      </button>

      {open && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          style={{
            position: 'fixed', right: 20, bottom: 88, zIndex: 1000,
            width: 'min(380px, calc(100vw - 40px))', height: 'min(560px, calc(100vh - 140px))',
            display: 'flex', flexDirection: 'column',
            background: 'var(--surface, #fff)', color: 'inherit',
            border: dragging ? `2px dashed ${accent}` : '1px solid var(--border, #e2e8f0)',
            borderRadius: 14, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,.28)',
          }}
        >
          <div style={{ background: brandGradient, color: '#fff', padding: '12px 16px', fontWeight: 600, fontSize: 15 }}>
            AI Assistant
            <div style={{ fontWeight: 400, fontSize: 12, opacity: 0.85 }}>Ask about your inventory — drag in a photo too</div>
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
            {dragging && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(30,94,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent, fontWeight: 600, fontSize: 14, pointerEvents: 'none' }}>
                Drop image to attach
              </div>
            )}
            {messages.length === 0 && (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted, #64748b)', fontSize: 13 }}>
                <p style={{ marginBottom: 10 }}>How can I help with your inventory?</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="btn secondary" style={{ fontSize: 12 }} onClick={() => { setInput(s); }}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', display: 'flex', flexDirection: 'column', gap: 6, alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {m.images && m.images.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {m.images.map((src, k) => (
                      <img key={k} src={src} alt="attachment" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border, #e2e8f0)' }} />
                    ))}
                  </div>
                )}
                {m.content && (
                  <div style={{ background: m.role === 'user' ? accent : 'var(--background, #f5f7fa)', color: m.role === 'user' ? '#fff' : 'inherit', borderRadius: 12, padding: '8px 12px', lineHeight: 1.5, fontSize: 13.5, ...(m.role === 'user' ? { whiteSpace: 'pre-wrap' as const } : {}) }}>
                    {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
                  </div>
                )}
              </div>
            ))}
            {loading && <div style={{ alignSelf: 'flex-start', color: 'var(--text-muted, #64748b)', fontSize: 13 }}>Thinking…</div>}
          </div>

          {attachments.length > 0 && (
            <div style={{ display: 'flex', gap: 6, padding: '8px 10px 0', flexWrap: 'wrap' }}>
              {attachments.map((a, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={a.preview} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)' }} />
                  <button onClick={() => setAttachments((arr) => arr.filter((_, k) => k !== i))} aria-label="Remove image"
                    style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#1a2332', color: '#fff', fontSize: 12, lineHeight: '18px', cursor: 'pointer', padding: 0 }}>×</button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--border, #e2e8f0)', padding: 10 }}>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
            <button type="button" aria-label="Attach image" title="Attach image" onClick={() => fileRef.current?.click()}
              disabled={loading || unavailable || attachments.length >= 4}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, padding: '0 2px' }}>📎</button>
            <input
              className="field" style={{ flex: 1 }}
              placeholder={unavailable ? 'AI not configured' : 'Ask, or drop/paste an image…'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.items).filter((it) => it.type.startsWith('image/')).map((it) => it.getAsFile()).filter(Boolean) as File[];
                if (files.length) { e.preventDefault(); addFiles(files); }
              }}
              disabled={loading || unavailable}
            />
            <button className="btn" type="submit" disabled={!canSend}>Send</button>
          </form>
        </div>
      )}
    </>
  );
}
