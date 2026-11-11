// markdown.tsx — safe, lightweight Markdown renderer for agent replies.
//
// Returns REACT NODES — never HTML (no dangerouslySetInnerHTML), eliminating
// injection vectors entirely. Supports bold, italic, inline code, fenced code
// blocks, headings (# to ####), blockquotes (>), links ([a](url)), horizontal rules,
// and lists (- / * / 1.). Unsupported syntax degrades to clean plain text.

import type { ReactNode } from 'react';

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)\s]+\))/g;

/** Inline marks inside one line of text. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  for (const part of text.split(INLINE)) {
    if (!part) continue;
    const key = `${keyBase}-${i++}`;
    if (
      (part.startsWith('**') && part.endsWith('**') && part.length > 4) ||
      (part.startsWith('__') && part.endsWith('__') && part.length > 4)
    ) {
      out.push(<strong key={key} className="font-semibold text-[var(--text-primary)]">{part.slice(2, -2)}</strong>);
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      out.push(
        <code key={key} className="cut-corners bg-[var(--bg-hover)] px-1 py-px text-[11px] text-[var(--text-primary)] font-mono">
          {part.slice(1, -1)}
        </code>,
      );
    } else if (
      (part.startsWith('*') && part.endsWith('*') && part.length > 2) ||
      (part.startsWith('_') && part.endsWith('_') && part.length > 2)
    ) {
      out.push(<em key={key}>{part.slice(1, -1)}</em>);
    } else if (part.startsWith('[') && part.includes('](') && part.endsWith(')')) {
      const splitIdx = part.indexOf('](');
      const label = part.slice(1, splitIdx);
      const url = part.slice(splitIdx + 2, -1);
      const isSafe = /^(https?:\/\/|\/|#)/i.test(url);
      if (isSafe) {
        out.push(
          <a
            key={key}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent,#3b82f6)] underline underline-offset-2 hover:opacity-80"
          >
            {label}
          </a>,
        );
      } else {
        out.push(part);
      }
    } else {
      out.push(part);
    }
  }
  return out;
}

/** A bullet: `- `, `* ` or `1. ` at the start of a line. */
const BULLET = /^\s*(?:[-*]|\d+\.)\s+/;
/** A heading: `# Title` up to `#### Title`. */
const HEADING = /^(#{1,4})\s+(.+)$/;
/** A blockquote: `> Quote`. */
const BLOCKQUOTE = /^>\s?(.*)$/;
/** A horizontal rule: `---`, `***`, `___`. */
const HR = /^(?:---|\*\*\*|___)\s*$/;

/**
 * Render an agent message. Blank lines separate paragraphs; consecutive
 * bullet lines become one list. Headings, code blocks, blockquotes, and
 * inline formatting are rendered cleanly.
 */
export function renderMarkdown(text: string): ReactNode {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    const body = para.join('\n');
    blocks.push(
      <p key={`p${blocks.length}`} className="whitespace-pre-wrap break-words leading-relaxed text-[var(--text-secondary)]">
        {renderInline(body, `p${blocks.length}`)}
      </p>,
    );
    para = [];
  };

  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={`u${blocks.length}`} className="flex list-none flex-col gap-1 pl-1">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-1.5 break-words text-[var(--text-secondary)] leading-relaxed">
            <span className="shrink-0 text-[var(--accent,#3b82f6)] font-bold">•</span>
            <span>{renderInline(b, `u${blocks.length}-${i}`)}</span>
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmed = line.trim();

    // 1. Fenced Code Block start / end
    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        flushBullets();
        flushPara();
        inCodeBlock = true;
        codeLang = trimmed.slice(3).trim();
        codeLines = [];
        continue;
      } else {
        inCodeBlock = false;
        const codeText = codeLines.join('\n');
        blocks.push(
          <div
            key={`code${blocks.length}`}
            className="my-1.5 overflow-hidden rounded border border-[var(--border-light)] bg-[var(--bg-secondary,rgba(0,0,0,0.25))] font-mono text-[11px]"
          >
            {codeLang ? (
              <div className="flex items-center justify-between border-b border-[var(--border-light)] bg-[var(--bg-hover,rgba(255,255,255,0.03))] px-2.5 py-1 text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">
                <span>{codeLang}</span>
              </div>
            ) : null}
            <pre className="overflow-x-auto p-2.5 leading-relaxed text-[var(--text-primary)] scrollbar-thin">
              <code>{codeText}</code>
            </pre>
          </div>,
        );
        codeLines = [];
        continue;
      }
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // 2. Horizontal Rule
    if (HR.test(trimmed)) {
      flushBullets();
      flushPara();
      blocks.push(<hr key={`hr${blocks.length}`} className="my-2 border-[var(--border-light)] opacity-60" />);
      continue;
    }

    // 3. Headings
    const headingMatch = line.match(HEADING);
    if (headingMatch) {
      flushBullets();
      flushPara();
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const key = `h${blocks.length}`;
      if (level === 1) {
        blocks.push(<h1 key={key} className="mt-2.5 mb-1 text-sm font-bold text-[var(--text-primary)]">{renderInline(content, key)}</h1>);
      } else if (level === 2) {
        blocks.push(<h2 key={key} className="mt-2 mb-0.5 text-[13px] font-bold text-[var(--text-primary)]">{renderInline(content, key)}</h2>);
      } else if (level === 3) {
        blocks.push(<h3 key={key} className="mt-1.5 mb-0.5 text-xs font-semibold text-[var(--text-primary)]">{renderInline(content, key)}</h3>);
      } else {
        blocks.push(<h4 key={key} className="mt-1 mb-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">{renderInline(content, key)}</h4>);
      }
      continue;
    }

    // 4. Blockquotes
    const bqMatch = line.match(BLOCKQUOTE);
    if (bqMatch && trimmed !== '>') {
      flushBullets();
      flushPara();
      blocks.push(
        <blockquote
          key={`bq${blocks.length}`}
          className="my-1 border-l-2 border-[var(--accent,#3b82f6)] pl-2 text-xs italic text-[var(--text-secondary)] leading-relaxed"
        >
          {renderInline(bqMatch[1], `bq${blocks.length}`)}
        </blockquote>,
      );
      continue;
    }

    // 5. Bullets
    if (BULLET.test(line)) {
      flushPara();
      bullets.push(line.replace(BULLET, ''));
      continue;
    }

    // 6. Blank lines
    if (trimmed === '') {
      flushBullets();
      flushPara();
      continue;
    }

    // 7. Regular paragraph lines
    flushBullets();
    para.push(line);
  }

  // Handle unclosed code block gracefully
  if (inCodeBlock && codeLines.length > 0) {
    blocks.push(
      <div
        key={`code${blocks.length}`}
        className="my-1.5 overflow-hidden rounded border border-[var(--border-light)] bg-[var(--bg-secondary,rgba(0,0,0,0.25))] font-mono text-[11px]"
      >
        <pre className="overflow-x-auto p-2.5 leading-relaxed text-[var(--text-primary)] scrollbar-thin">
          <code>{codeLines.join('\n')}</code>
        </pre>
      </div>,
    );
  }

  flushBullets();
  flushPara();

  return <div className="flex flex-col gap-1.5">{blocks}</div>;
}
