// heal-motion-tags.test.ts — auto-heal HTML tags to motion.<tag> for animated/interactive elements

import { describe, it, expect } from 'vitest';
import { healMotionTags } from './heal-motion-tags';

describe('healMotionTags', () => {
  it('converts a div with whileHover to motion.div and adds framer-motion import', () => {
    const raw = `export default function Card() {
  return (
    <div data-id="card" whileHover={{ scale: 1.05 }}>
      <span>Static Text</span>
    </div>
  );
}`;
    const { code, healedCount } = healMotionTags(raw);
    expect(healedCount).toBe(1);
    expect(code).toContain("import { motion } from 'framer-motion';");
    expect(code).toContain('<motion.div data-id="card" whileHover={{ scale: 1.05 }}>');
    expect(code).toContain('</motion.div>');
    expect(code).toContain('<span>Static Text</span>');
  });

  it('converts self-closing element with animation prop', () => {
    const raw = `export default function Photo() {
  return <img data-id="pic" src="/a.png" animate={{ opacity: 1 }} />;
}`;
    const { code, healedCount } = healMotionTags(raw);
    expect(healedCount).toBe(1);
    expect(code).toContain("import { motion } from 'framer-motion';");
    expect(code).toContain('<motion.img data-id="pic" src="/a.png" animate={{ opacity: 1 }} />');
  });

  it('converts nested elements when animated, leaves static elements intact', () => {
    const raw = `export default function Complex() {
  return (
    <div data-id="container" variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}>
      <h1 data-id="title">Title</h1>
      <button data-id="btn" whileTap={{ scale: 0.95 }}>Click</button>
    </div>
  );
}`;
    const { code, healedCount } = healMotionTags(raw);
    expect(healedCount).toBe(2);
    expect(code).toContain('<motion.div data-id="container" variants=');
    expect(code).toContain('</motion.div>');
    expect(code).toContain('<h1 data-id="title">Title</h1>');
    expect(code).toContain('<motion.button data-id="btn" whileTap={{ scale: 0.95 }}>Click</motion.button>');
  });

  it('converts elements with layout and layoutId props', () => {
    const raw = `export default function Tabs() {
  return (
    <div data-id="tabs">
      <div data-id="tab-indicator" layoutId="underline" layout />
    </div>
  );
}`;
    const { code, healedCount } = healMotionTags(raw);
    expect(healedCount).toBe(1);
    expect(code).toContain('<motion.div data-id="tab-indicator" layoutId="underline" layout />');
    expect(code).toContain('<div data-id="tabs">');
  });

  it('converts elements with exit prop', () => {
    const raw = `import { AnimatePresence } from 'framer-motion';
export default function Modal({ isOpen }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div data-id="modal" exit={{ opacity: 0 }}>
          <p>Modal body</p>
        </div>
      )}
    </AnimatePresence>
  );
}`;
    const { code, healedCount } = healMotionTags(raw);
    expect(healedCount).toBe(1);
    expect(code).toContain("import { AnimatePresence, motion } from 'framer-motion';");
    expect(code).toContain('<motion.div data-id="modal" exit={{ opacity: 0 }}>');
    expect(code).toContain('</motion.div>');
    expect(code).toContain('<p>Modal body</p>');
  });

  it('converts elements targeted by connections sourceNode', () => {
    const raw = `const connections = [
  { from: 'default', to: 'hover', trigger: 'mouseEnter', sourceNode: 'sub-box' }
];

export default function Component() {
  return (
    <div data-id="root">
      <div data-id="sub-box">Hover Me</div>
    </div>
  );
}`;
    const { code, healedCount } = healMotionTags(raw);
    expect(healedCount).toBe(1);
    expect(code).toContain('<motion.div data-id="sub-box">Hover Me</motion.div>');
    expect(code).toContain('<div data-id="root">');
  });

  it('converts component root element when root-level connections exist', () => {
    const raw = `const connections = [
  { from: 'default', to: 'hover', trigger: 'mouseEnter' }
];

export default function ProjectCard() {
  return (
    <div data-id="project-card-root">
      <span data-id="title">Hello</span>
    </div>
  );
}`;
    const { code, healedCount } = healMotionTags(raw);
    expect(healedCount).toBe(1);
    expect(code).toContain('<motion.div data-id="project-card-root">');
    expect(code).toContain('</motion.div>');
    expect(code).toContain('<span data-id="title">Hello</span>');
  });

  it('converts elements with motion event handlers like onHoverStart and onTap', () => {
    const raw = `export default function Interactive() {
  return (
    <section data-id="sec" onHoverStart={() => {}} onHoverEnd={() => {}}>
      <a data-id="link" href="#" onTap={() => {}}>Go</a>
    </section>
  );
}`;
    const { code, healedCount } = healMotionTags(raw);
    expect(healedCount).toBe(2);
    expect(code).toContain('<motion.section data-id="sec" onHoverStart=');
    expect(code).toContain('</motion.section>');
    expect(code).toContain('<motion.a data-id="link" href="#" onTap=');
    expect(code).toContain('</motion.a>');
  });

  it('does not touch already motion.* elements or uppercase React components', () => {
    const raw = `import { motion } from 'framer-motion';
export default function Custom() {
  return (
    <motion.div data-id="m1" whileHover={{ scale: 1.1 }}>
      <CustomButton data-id="b1" whileTap={{ scale: 0.9 }}>Click</CustomButton>
    </motion.div>
  );
}`;
    const { code, healedCount } = healMotionTags(raw);
    expect(healedCount).toBe(0);
    expect(code).toBe(raw);
  });

  it('does not touch non-animated static HTML elements', () => {
    const raw = `export default function StaticPage() {
  return (
    <div data-id="root" className="container">
      <h1 data-id="heading">Hello</h1>
      <p data-id="desc">Paragraph</p>
      <button data-id="btn" onClick={() => alert('hi')}>Submit</button>
    </div>
  );
}`;
    const { code, healedCount } = healMotionTags(raw);
    expect(healedCount).toBe(0);
    expect(code).toBe(raw);
  });

  it('preserves user comments, formatting, and "use client" directives', () => {
    const raw = `'use client';

// Leading comment
export default function Form() {
  return (
    <form
      data-id="contact-form"
      /* inline comment */
      whileFocus={{ scale: 1.01 }}
    >
      <input type="text" />
    </form>
  );
}`;
    const { code, healedCount } = healMotionTags(raw);
    expect(healedCount).toBe(1);
    expect(code).toMatch(/^'use client';\s*\nimport { motion } from 'framer-motion';/);
    expect(code).toContain('// Leading comment');
    expect(code).toContain('/* inline comment */');
    expect(code).toContain('<motion.form');
    expect(code).toContain('</motion.form>');
    expect(code).toContain('<input type="text" />');
  });
});
