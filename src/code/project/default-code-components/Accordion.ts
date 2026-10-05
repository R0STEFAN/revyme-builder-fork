// Accordion — Code component template (expandable accordion card with spring animations).
// Adapted from Framer accordion component with Framer Motion spring physics.
// Supports adding multiple questions and answers via the "objectList" control.
// SEO & Accessibility optimized: content stays in the DOM when collapsed (height: 0).

export const ACCORDION_COMPONENT = `'use client';

/** @label "Accordion" */
/** @comment "Expandable accordion with smooth spring animations and multiple questions" */
/** @defaultWidth 391 */
/** @defaultHeight 200 */
/** @controls {
  "items": {
    "type": "objectList",
    "label": "Questions & Answers",
    "itemLabel": "question",
    "default": [
      {
        "question": "What is Framer?",
        "answer": "Framer is a design tool that allows you to design websites on a freeform canvas, and then publish them as websites with a single click."
      },
      {
        "question": "Can I add more questions?",
        "answer": "Yes! In the Properties panel on the right, click on Questions & Answers to add, reorder, or edit as many items as you need."
      }
    ],
    "item": {
      "controls": {
        "question": { "type": "text", "label": "Question", "default": "New Question" },
        "answer": { "type": "text", "label": "Answer", "default": "New answer details go here." }
      }
    }
  },
  "allowMultiple": { "type": "toggle", "label": "Allow Multiple Open", "default": false },
  "gap": { "type": "number", "label": "Gap", "min": 0, "max": 40, "step": 1, "default": 10, "unit": "px" },
  "background": { "type": "color", "label": "Background", "default": "#1f1f1f" },
  "textColor": { "type": "color", "label": "Question Color", "default": "#ffffff" },
  "answerColor": { "type": "color", "label": "Answer Color", "default": "#999999" },
  "iconBackground": { "type": "color", "label": "Icon Background", "default": "rgba(38, 38, 38, 0.99)" },
  "iconColor": { "type": "color", "label": "Icon Color", "default": "#999999" },
  "borderColor": { "type": "color", "label": "Border Color", "default": "rgba(255, 255, 255, 0.07)" },
  "borderRadius": { "type": "number", "label": "Radius", "min": 0, "max": 40, "step": 1, "default": 16, "unit": "px" },
  "fontSize": { "type": "number", "label": "Font Size", "min": 10, "max": 32, "step": 1, "default": 14, "unit": "px" }
} */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

function Accordion({
  items = [
    {
      question: 'What is Framer?',
      answer: 'Framer is a design tool that allows you to design websites on a freeform canvas, and then publish them as websites with a single click.',
    },
    {
      question: 'Can I add more questions?',
      answer: 'Yes! In the Properties panel on the right, click on Questions & Answers to add, reorder, or edit as many items as you need.',
    },
  ],
  allowMultiple = false,
  gap = 10,
  background = '#1f1f1f',
  textColor = '#ffffff',
  answerColor = '#999999',
  iconBackground = 'rgba(38, 38, 38, 0.99)',
  iconColor = '#999999',
  borderColor = 'rgba(255, 255, 255, 0.07)',
  borderRadius = 16,
  fontSize = 14,
  ...props
}: any) {
  const [openIndices, setOpenIndices] = useState<number[]>([0]);

  const list = Array.isArray(items) && items.length > 0
    ? items
    : [
        {
          question: props.question || 'What is Framer?',
          answer: props.answer || 'Framer is a design tool that allows you to design websites on a freeform canvas, and then publish them as websites with a single click.',
        },
      ];

  const toggleIndex = (index: number) => {
    setOpenIndices((prev) => {
      const isOpen = prev.includes(index);
      if (isOpen) {
        return prev.filter((i) => i !== index);
      }
      if (allowMultiple) {
        return [...prev, index];
      }
      return [index];
    });
  };

  return (
    <div
      {...props}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: gap + 'px',
        width: '100%',
        boxSizing: 'border-box',
        ...props.style,
      }}
    >
      {list.map((item: any, index: number) => {
        const isOpen = openIndices.includes(index);
        return (
          <div
            key={index}
            onClick={(e) => {
              e.stopPropagation();
              toggleIndex(index);
            }}
            role="button"
            aria-expanded={isOpen}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleIndex(index);
              }
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-start',
              gap: '5px',
              padding: '15px',
              backgroundColor: background,
              borderRadius: borderRadius + 'px',
              border: '1px solid ' + borderColor,
              boxShadow: '0px 2px 4px 0px rgba(0, 0, 0, 0.15), 0px 5px 10px 0px rgba(0, 0, 0, 0.1)',
              overflow: 'hidden',
              cursor: 'pointer',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '20px',
                width: '100%',
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: fontSize + 'px',
                  fontWeight: 500,
                  lineHeight: 1.4,
                  color: textColor,
                  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
                  userSelect: 'none',
                  wordBreak: 'break-word',
                }}
              >
                {item.question}
              </span>
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '100px',
                  backgroundColor: iconBackground,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  flexShrink: 0,
                  overflow: 'hidden',
                }}
              >
                {/* Static horizontal line */}
                <div
                  style={{
                    position: 'absolute',
                    width: '1px',
                    height: '10px',
                    backgroundColor: iconColor,
                    transform: 'rotate(270deg)',
                    left: 'calc(50% - 0.5px)',
                    top: 'calc(50% - 5px)',
                  }}
                />
                {/* Animated vertical-to-horizontal line */}
                <motion.div
                  initial={false}
                  animate={{ rotate: isOpen ? 90 : 0 }}
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
                  style={{
                    position: 'absolute',
                    width: '1px',
                    height: '10px',
                    backgroundColor: iconColor,
                    left: 'calc(50% - 0.5px)',
                    top: 'calc(50% - 5px)',
                  }}
                />
              </div>
            </div>

            {/* Answer stays in the DOM for SEO & Googlebot indexability */}
            <motion.div
              initial={false}
              animate={{
                height: isOpen ? 'auto' : 0,
                opacity: isOpen ? 1 : 0,
                x: isOpen ? 0 : -10,
              }}
              transition={{
                height: { duration: 0.35, ease: [0.02, 0.69, 0.48, 1] },
                opacity: { duration: 0.25, delay: isOpen ? 0.05 : 0 },
                x: { duration: 0.25, delay: isOpen ? 0.05 : 0 },
              }}
              style={{
                width: '100%',
                overflow: 'hidden',
                paddingRight: '44px',
                boxSizing: 'border-box',
                pointerEvents: isOpen ? 'auto' : 'none',
              }}
              aria-hidden={!isOpen}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: fontSize + 'px',
                  fontWeight: 500,
                  lineHeight: '1.5em',
                  color: answerColor,
                  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
                  userSelect: 'none',
                  wordBreak: 'break-word',
                }}
              >
                {item.answer}
              </p>
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}

export default withResponsiveProps(Accordion);
`;
