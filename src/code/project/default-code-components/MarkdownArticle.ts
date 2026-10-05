// MarkdownArticle — Code component template for rendering CMS articles and Markdown content.
// Source string for the default-project virtual file system.

export const MARKDOWN_ARTICLE_COMPONENT = `'use client';

/** @label "Markdown Article" */
/** @comment "Renders formatted articles with customizable typography from CMS Markdown or custom text" */
/** @defaultWidth 760 */
/** @defaultHeight 600 */
/** @controls {
  "content": { "type": "text", "label": "Article Content (Markdown)", "default": "# Main Article Title\\n\\n### Subtitle or Section\\n\\nThis is a formatted paragraph with **bold text**, *italic*, and a [link](https://example.com).\\n\\n> This is an important quote or highlight from the author.\\n\\n* First bullet point\\n* Second bullet point\\n\\n### Second Subtitle\\n\\nAnother paragraph with detailed information." },
  "baseSize": { "type": "number", "label": "Base Font Size (px)", "min": 12, "max": 28, "default": 16, "step": 1 },
  "headingFont": { "type": "font", "label": "Heading Font", "default": "Inter, sans-serif" },
  "bodyFont": { "type": "font", "label": "Body Font", "default": "Inter, sans-serif" },
  "headingColor": { "type": "color", "label": "Heading Color", "default": "#ffffff" },
  "textColor": { "type": "color", "label": "Body Text Color", "default": "#a1a1aa" },
  "accentColor": { "type": "color", "label": "Accent / Link Color", "default": "#eab308" },
  "h3Color": { "type": "color", "label": "H3 Override Color (Optional)", "default": "" },
  "lineHeight": { "type": "number", "label": "Line Height", "min": 1.2, "max": 2.5, "default": 1.75, "step": 0.05 },
  "maxWidth": { "type": "number", "label": "Max Width (px)", "min": 320, "max": 1400, "default": 760, "step": 10 }
} */

import React, { useMemo } from 'react';
import { withResponsiveProps } from '@revyme/runtime';

interface MarkdownArticleProps {
  content?: string;
  baseSize?: number;
  headingFont?: string;
  bodyFont?: string;
  headingColor?: string;
  textColor?: string;
  accentColor?: string;
  h3Color?: string;
  lineHeight?: number;
  maxWidth?: number;
  [key: string]: any;
}

// Inline formatting: bold, italic, links, code
function renderInline(text: string, accentColor: string, headingColor: string): React.ReactNode[] {
  // Regex matches: [link](url) | **bold** | *italic* | \`code\`
  const regex = /(\\[[^\\]]+\\]\\([^)]+\\)|\\*\\*[^\\*]+\\*\\*|\\*[^*]+\\*|_[^_]+_|\\\`[^\\\`]+\\\`)/g;
  const parts = text.split(regex);

  return parts.map((part, i) => {
    if (!part) return null;

    // Link: [label](url)
    const linkMatch = part.match(/^\\[([^\\]]+)\\]\\(([^)]+)\\)$/);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: accentColor,
            textDecoration: 'underline',
            textUnderlineOffset: '3px',
            fontWeight: 500,
          }}
        >
          {linkMatch[1]}
        </a>
      );
    }

    // Bold: **text**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={i} style={{ color: headingColor, fontWeight: 700 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }

    // Italic: *text* or _text_
    if ((part.startsWith('*') && part.endsWith('*') && part.length >= 2) ||
        (part.startsWith('_') && part.endsWith('_') && part.length >= 2)) {
      return (
        <em key={i} style={{ fontStyle: 'italic', opacity: 0.9 }}>
          {part.slice(1, -1)}
        </em>
      );
    }

    // Inline code: \`code\`
    if (part.startsWith('\`') && part.endsWith('\`') && part.length >= 2) {
      return (
        <code
          key={i}
          style={{
            background: 'rgba(255,255,255,0.08)',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '0.9em',
            fontFamily: 'ui-monospace, monospace',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    return part;
  });
}

function MarkdownArticleComponent({
  content = '',
  baseSize = 16,
  headingFont = 'Inter, sans-serif',
  bodyFont = 'Inter, sans-serif',
  headingColor = '#ffffff',
  textColor = '#a1a1aa',
  accentColor = '#eab308',
  h3Color = '',
  lineHeight = 1.75,
  maxWidth = 760,
  ...props
}: MarkdownArticleProps) {
  const actualH3Color = h3Color && h3Color.trim() ? h3Color.trim() : headingColor;

  // Block parser
  const blocks = useMemo(() => {
    if (!content) return [];
    const lines = String(content).replace(/\\r\\n/g, '\\n').split('\\n');
    const result: React.ReactNode[] = [];

    let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;
    let blockIndex = 0;

    const flushList = () => {
      if (!currentList) return;
      const Tag = currentList.type;
      result.push(
        <Tag
          key={\`list-\${blockIndex++}\`}
          style={{
            margin: \`0 0 \${baseSize * 1.2}px 0\`,
            paddingLeft: baseSize * 1.5,
            color: textColor,
            lineHeight,
            fontSize: baseSize,
            fontFamily: bodyFont,
          }}
        >
          {currentList.items.map((item, idx) => (
            <li key={idx} style={{ marginBottom: baseSize * 0.4 }}>
              {renderInline(item, accentColor, headingColor)}
            </li>
          ))}
        </Tag>
      );
      currentList = null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) {
        flushList();
        continue;
      }

      // Horizontal separator: --- or ***
      if (/^(\\*\\*\\*|---|___)$/.test(line)) {
        flushList();
        result.push(
          <hr
            key={\`hr-\${blockIndex++}\`}
            style={{
              border: 'none',
              borderTop: '1px solid rgba(255,255,255,0.12)',
              margin: \`\${baseSize * 2}px 0\`,
            }}
          />
        );
        continue;
      }

      // Headings
      if (line.startsWith('# ')) {
        flushList();
        result.push(
          <h1
            key={\`h1-\${blockIndex++}\`}
            style={{
              fontFamily: headingFont,
              fontSize: Math.round(baseSize * 2.25),
              fontWeight: 800,
              color: headingColor,
              margin: \`\${baseSize * 2.2}px 0 \${baseSize * 0.9}px 0\`,
              lineHeight: 1.2,
            }}
          >
            {renderInline(line.slice(2).trim(), accentColor, headingColor)}
          </h1>
        );
        continue;
      }

      if (line.startsWith('## ')) {
        flushList();
        result.push(
          <h2
            key={\`h2-\${blockIndex++}\`}
            style={{
              fontFamily: headingFont,
              fontSize: Math.round(baseSize * 1.75),
              fontWeight: 700,
              color: headingColor,
              margin: \`\${baseSize * 1.9}px 0 \${baseSize * 0.8}px 0\`,
              lineHeight: 1.25,
            }}
          >
            {renderInline(line.slice(3).trim(), accentColor, headingColor)}
          </h2>
        );
        continue;
      }

      if (line.startsWith('### ')) {
        flushList();
        result.push(
          <h3
            key={\`h3-\${blockIndex++}\`}
            style={{
              fontFamily: headingFont,
              fontSize: Math.round(baseSize * 1.35),
              fontWeight: 600,
              color: actualH3Color,
              margin: \`\${baseSize * 1.6}px 0 \${baseSize * 0.7}px 0\`,
              lineHeight: 1.3,
            }}
          >
            {renderInline(line.slice(4).trim(), accentColor, actualH3Color)}
          </h3>
        );
        continue;
      }

      if (line.startsWith('#### ')) {
        flushList();
        result.push(
          <h4
            key={\`h4-\${blockIndex++}\`}
            style={{
              fontFamily: headingFont,
              fontSize: Math.round(baseSize * 1.15),
              fontWeight: 600,
              color: headingColor,
              margin: \`\${baseSize * 1.4}px 0 \${baseSize * 0.6}px 0\`,
              lineHeight: 1.35,
            }}
          >
            {renderInline(line.slice(5).trim(), accentColor, headingColor)}
          </h4>
        );
        continue;
      }

      // Blockquote: > text
      if (line.startsWith('> ')) {
        flushList();
        result.push(
          <blockquote
            key={\`quote-\${blockIndex++}\`}
            style={{
              borderLeft: \`3px solid \${accentColor}\`,
              paddingLeft: baseSize * 1.2,
              margin: \`\${baseSize * 1.5}px 0\`,
              fontStyle: 'italic',
              color: textColor,
              opacity: 0.9,
              fontSize: Math.round(baseSize * 1.05),
              lineHeight,
              fontFamily: bodyFont,
            }}
          >
            {renderInline(line.slice(2).trim(), accentColor, headingColor)}
          </blockquote>
        );
        continue;
      }

      // Unordered list: - item or * item
      if (/^[-*]\\s+/.test(line)) {
        const itemText = line.replace(/^[-*]\\s+/, '');
        if (!currentList || currentList.type !== 'ul') {
          flushList();
          currentList = { type: 'ul', items: [itemText] };
        } else {
          currentList.items.push(itemText);
        }
        continue;
      }

      // Ordered list: 1. item
      if (/^\\d+\\.\\s+/.test(line)) {
        const itemText = line.replace(/^\\d+\\.\\s+/, '');
        if (!currentList || currentList.type !== 'ol') {
          flushList();
          currentList = { type: 'ol', items: [itemText] };
        } else {
          currentList.items.push(itemText);
        }
        continue;
      }

      // Paragraph
      flushList();
      result.push(
        <p
          key={\`p-\${blockIndex++}\`}
          style={{
            fontFamily: bodyFont,
            fontSize: baseSize,
            color: textColor,
            lineHeight,
            margin: \`0 0 \${baseSize * 1.15}px 0\`,
          }}
        >
          {renderInline(line, accentColor, headingColor)}
        </p>
      );
    }

    flushList();
    return result;
  }, [content, baseSize, headingFont, bodyFont, headingColor, textColor, accentColor, actualH3Color, lineHeight]);

  return (
    <article
      {...props}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: maxWidth ? \`\${maxWidth}px\` : '760px',
        margin: '0 auto',
        padding: '16px 0',
        ...props.style,
      }}
    >
      {blocks.length > 0 ? blocks : (
        <div style={{ color: textColor, opacity: 0.5, fontStyle: 'italic', fontSize: baseSize }}>
          No content provided.
        </div>
      )}
    </article>
  );
}

export default withResponsiveProps(MarkdownArticleComponent);
`;
