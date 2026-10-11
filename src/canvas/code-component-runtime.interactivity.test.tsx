import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { compileCodeComponent, clearCodeComponentCache } from './code-component-runtime';
import {
  ACCORDION_COMPONENT,
  COPY_BUTTON_COMPONENT,
  THEME_TOGGLE_COMPONENT,
} from '@/code/project/default-code-components';

let clipboardDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  clearCodeComponentCache();
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (clipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  } else {
    delete (navigator as any).clipboard;
  }
});

function compile(source: string, name: string, previewMode: boolean) {
  const Component = compileCodeComponent(source, name, { previewMode });
  expect(Component).not.toBeNull();
  return Component!;
}

describe('code component interactions', () => {
  it('copies with the real CopyButton template and shows feedback in preview', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const Button = compile(COPY_BUTTON_COMPONENT, 'CopyButton', true);
    render(<Button />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied!' })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith('hello@revyme.app');
  });

  it('suppresses CopyButton clicks on the static canvas', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const Button = compile(COPY_BUTTON_COMPONENT, 'CopyButton', false);
    render(<Button />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('opens the real Accordion template by click and keyboard in preview', () => {
    const Accordion = compile(ACCORDION_COMPONENT, 'Accordion', true);
    render(<Accordion />);
    const first = screen.getAllByRole('button')[0];
    expect(first.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(first);
    expect(first.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(first.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps preview pointer listeners, but suppresses them on the canvas', () => {
    const source = `import React, { useEffect, useState } from 'react';
      export default function PointerDemo() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          const onMove = () => { setCount(n => n + 1); };
          window.addEventListener('pointermove', onMove, Boolean(0));
          return () => window.removeEventListener('pointermove', onMove, Boolean(0));
        }, []);
        return <button onPointerEnter={() => setCount(n => n + 1)} onKeyDown={() => setCount(n => n + 1)}>{count}</button>;
      }`;
    const Preview = compile(source, 'PointerDemo', true);
    const view = render(<Preview />);
    const button = screen.getByRole('button');
    fireEvent.pointerEnter(button);
    expect(button.textContent).toBe('1');
    fireEvent.pointerMove(window);
    expect(button.textContent).toBe('2');
    view.unmount();

    const Canvas = compile(source, 'PointerDemo', false);
    render(<Canvas />);
    const canvasButton = screen.getByRole('button');
    fireEvent.pointerEnter(canvasButton);
    fireEvent.pointerMove(window);
    expect(canvasButton.textContent).toBe('0');
    fireEvent.keyDown(canvasButton);
    expect(canvasButton.textContent).toBe('1');
  });

  it('keeps preview theme state local to the component and leaves editor theme alone', async () => {
    document.documentElement.classList.remove('dark');
    const Toggle = compile(THEME_TOGGLE_COMPONENT, 'ThemeToggle', true);
    render(<><Toggle /><Toggle /></>);
    const toggles = screen.getAllByRole('button');
    await waitFor(() => expect(toggles[0].getAttribute('aria-label')).toBe('Switch to dark theme'));
    fireEvent.click(toggles[0]);
    expect(toggles[0].getAttribute('aria-label')).toBe('Switch to light theme');
    expect(toggles[1].getAttribute('aria-label')).toBe('Switch to dark theme');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('honors a preview ThemeProvider default and updater without changing the document', () => {
    document.documentElement.classList.remove('dark');
    const source = `import React from 'react';
      import { ThemeProvider, useTheme } from 'next-themes';
      function Control() {
        const { theme, setTheme } = useTheme();
        return <button onClick={() => setTheme(previous => previous === 'dark' ? 'light' : 'dark')}>{theme}</button>;
      }
      export default function Demo() {
        return <ThemeProvider defaultTheme="dark"><Control /></ThemeProvider>;
      }`;
    const Demo = compile(source, 'Demo', true);
    render(<Demo />);
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('dark');
    fireEvent.click(button);
    expect(button.textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it.each([false, true])('compiles syntax with quoted and nested braces in previewMode=%s', (previewMode) => {
    const source = [
      "import React from 'react';",
      "export default function Braces() {",
      "  const nested = () => ({ value: '}' });",
      "  return <button onClick={() => {",
      "    const quoted = \"}\";",
      "    const escaped = 'it\\'s }';",
      '    const template = `right } ${nested().value}`;',
      "    /* a comment with } and onClick={ */",
      "    void [quoted, escaped, template];",
      "  }} onKeyDown={() => void nested()}>{nested().value}</button>;",
      "}",
    ].join('\n');
    const Braces = compile(source, 'Braces', previewMode);
    render(<Braces />);
    expect(screen.getByRole('button').textContent).toBe('}');
  });
});
