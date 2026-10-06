'use client';

/** @label "Animated Navigation" */
/** @comment "Fixed navigation bar with animated 2-line hamburger and full-screen overlay menu" */
/** @controls {
  "brandName": { "type": "text", "label": "Brand / Logo", "default": "ROSTYSLAW" },
  "statusText": { "type": "text", "label": "Availability Status", "default": "ДОСТУПНИЙ ДЛЯ ПРОЄКТІВ" },
  "accentColor": { "type": "color", "label": "Accent Color", "default": "#ff3300" }
} */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

interface NavProps {
  brandName?: string;
  statusText?: string;
  accentColor?: string;
  style?: React.CSSProperties;
}

const NAV_LINKS = [
  { label: 'ПРОЄКТИ', href: '#projects', num: '01' },
  { label: 'ПЕРЕВАГИ', href: '#benefits', num: '02' },
  { label: 'ПРОЦЕС РОБОТИ', href: '#process', num: '03' },
  { label: 'ВІДГУКИ', href: '#testimonials', num: '04' },
  { label: 'ЧАСТІ ПИТАННЯ', href: '#faq', num: '05' },
  { label: 'КОНТАКТИ', href: '#contact', num: '06' },
];

function NavigationMenu(props: NavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const accent = props.accentColor || '#ff3300';
  const brand = props.brandName || 'ROSTYSLAW';
  const status = props.statusText || 'ДОСТУПНИЙ ДЛЯ ПРОЄКТІВ';

  const toggle = () => setIsOpen(!isOpen);
  const close = () => setIsOpen(false);

  return (
    <>
      <header
        data-id="main-nav-header"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '72px',
          padding: '0 40px',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'rgba(255, 255, 255, 0.88)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
          zIndex: 9000,
          boxSizing: 'border-box',
          ...props.style,
        }}
      >
        {/* Brand Logo */}
        <a
          href="#"
          data-hover-target="true"
          style={{
            fontFamily: "'Unbounded', sans-serif",
            fontSize: '18px',
            fontWeight: 800,
            letterSpacing: '0.04em',
            textDecoration: 'none',
            color: '#09090b',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span>{brand}</span>
          <span style={{ color: accent }}>.</span>
        </a>

        {/* Live Status Badge */}
        <div
          style={{
            display: 'none',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            borderRadius: '9999px',
            backgroundColor: '#f1f3f5',
            border: '1px solid rgba(0, 0, 0, 0.06)',
            fontSize: '11px',
            fontWeight: 600,
            fontFamily: "'Inter', sans-serif",
            letterSpacing: '0.04em',
            color: '#3f3f46',
          }}
          className="desktop-status-badge"
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#22c55e',
              display: 'inline-block',
              boxShadow: '0 0 8px rgba(34, 197, 94, 0.6)',
            }}
          />
          <span>{status}</span>
        </div>

        {/* Right CTA + Hamburger */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <a
            href="#contact"
            data-hover-target="true"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '10px 20px',
              borderRadius: '9999px',
              backgroundColor: '#09090b',
              color: '#ffffff',
              fontFamily: "'Unbounded', sans-serif",
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              textDecoration: 'none',
            }}
          >
            ОБГОВОРИТИ ПРОЄКТ
          </a>

          {/* 2-line Animated Hamburger Button */}
          <button
            onClick={toggle}
            data-hover-target="true"
            aria-label="Toggle menu"
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              border: '1px solid rgba(0,0,0,0.15)',
              backgroundColor: '#ffffff',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer',
              zIndex: 9002,
            }}
          >
            <motion.span
              animate={isOpen ? { rotate: 45, y: 4 } : { rotate: 0, y: 0 }}
              transition={{ duration: 0.25 }}
              style={{
                width: '18px',
                height: '2px',
                backgroundColor: '#09090b',
                display: 'block',
              }}
            />
            <motion.span
              animate={isOpen ? { rotate: -45, y: -4 } : { rotate: 0, y: 0 }}
              transition={{ duration: 0.25 }}
              style={{
                width: '18px',
                height: '2px',
                backgroundColor: '#09090b',
                display: 'block',
              }}
            />
          </button>
        </div>
      </header>

      {/* Full-Screen Overlay Navigation */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              backgroundColor: '#ffffff',
              zIndex: 8999,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '80px',
              boxSizing: 'border-box',
              backgroundImage: 'radial-gradient(rgba(0, 0, 0, 0.08) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
                maxWidth: '800px',
              }}
            >
              {NAV_LINKS.map((link, idx) => (
                <motion.a
                  key={idx}
                  href={link.href}
                  onClick={close}
                  data-hover-target="true"
                  initial={{ opacity: 0, x: -30 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.06 + 0.1, duration: 0.3 }}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '24px',
                    textDecoration: 'none',
                    fontFamily: "'Unbounded', sans-serif",
                    fontSize: 'clamp(28px, 4.5vw, 56px)',
                    fontWeight: 800,
                    color: '#09090b',
                    letterSpacing: '-0.02em',
                    transition: 'color 0.2s ease, transform 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = accent;
                    e.currentTarget.style.transform = 'translateX(12px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#09090b';
                    e.currentTarget.style.transform = 'translateX(0px)';
                  }}
                >
                  <span
                    style={{
                      fontSize: '16px',
                      color: accent,
                      fontFamily: "'Inter', sans-serif",
                      fontWeight: 700,
                    }}
                  >
                    {link.num}
                  </span>
                  <span>{link.label}</span>
                </motion.a>
              ))}
            </div>

            <div
              style={{
                marginTop: 'auto',
                paddingTop: '40px',
                borderTop: '1px solid rgba(0,0,0,0.1)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '13px',
                fontFamily: "'Inter', sans-serif",
                color: '#71717a',
              }}
            >
              <span>KYIV, UKRAINE // REMOTE WORLDWIDE</span>
              <div style={{ display: 'flex', gap: '24px' }}>
                <a href="https://t.me" target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: '#09090b', fontWeight: 600 }}>TELEGRAM</a>
                <a href="https://linkedin.com" target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: '#09090b', fontWeight: 600 }}>LINKEDIN</a>
                <a href="https://instagram.com" target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: '#09090b', fontWeight: 600 }}>INSTAGRAM</a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default withResponsiveProps(NavigationMenu);
