import React from 'react';

// Minimal, dependency-free markdown renderer for assistant replies. Supports
// bold/italic/inline-code, #/##/### headings, bullet & numbered lists, and
// GitHub-style tables. All text is rendered through React (auto-escaped), so
// there is no HTML-injection surface.

function inline(text: string, kp: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) nodes.push(<strong key={kp + i}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`'))
      nodes.push(
        <code key={kp + i} style={{ background: 'rgba(0,0,0,.06)', padding: '1px 4px', borderRadius: 4, fontSize: '.9em' }}>
          {tok.slice(1, -1)}
        </code>
      );
    else nodes.push(<em key={kp + i}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function cellStyle(head: boolean): React.CSSProperties {
  return {
    border: '1px solid var(--border, #e2e8f0)',
    padding: '4px 8px',
    textAlign: 'left',
    background: head ? 'rgba(0,0,0,.04)' : 'transparent',
    fontWeight: head ? 600 : 400,
    verticalAlign: 'top',
  };
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  const isTableSep = (s: string) => s.includes('-') && /^\s*\|?[\s:|-]+\|?\s*$/.test(s);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // Table
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i++; }
      const tk = key++;
      blocks.push(
        <div key={tk} style={{ overflowX: 'auto', margin: '4px 0' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '.85em' }}>
            <thead>
              <tr>{header.map((h, c) => <th key={c} style={cellStyle(true)}>{inline(h, `th${tk}-${c}-`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((cv, c) => <td key={c} style={cellStyle(false)}>{inline(cv, `td${tk}-${ri}-${c}-`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Heading (rendered as a bold line — bubbles are small)
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) { blocks.push(<div key={key++} style={{ fontWeight: 700, margin: '6px 0 2px' }}>{inline(hm[2], `h${key}-`)}</div>); i++; continue; }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      const lk = key++;
      blocks.push(<ul key={lk} style={{ margin: '4px 0', paddingLeft: 18 }}>{items.map((it, ii) => <li key={ii}>{inline(it, `li${lk}-${ii}-`)}</li>)}</ul>);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      const lk = key++;
      blocks.push(<ol key={lk} style={{ margin: '4px 0', paddingLeft: 20 }}>{items.map((it, ii) => <li key={ii}>{inline(it, `ol${lk}-${ii}-`)}</li>)}</ol>);
      continue;
    }

    // Paragraph
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) && !lines[i].trim().startsWith('|')
    ) { para.push(lines[i]); i++; }
    const pk = key++;
    blocks.push(
      <p key={pk} style={{ margin: '4px 0', lineHeight: 1.5 }}>
        {para.map((pl, pi) => <React.Fragment key={pi}>{pi > 0 && <br />}{inline(pl, `p${pk}-${pi}-`)}</React.Fragment>)}
      </p>
    );
  }

  return <div style={{ display: 'flex', flexDirection: 'column' }}>{blocks}</div>;
}
