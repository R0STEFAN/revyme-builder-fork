'use client';

/** @canvas {
  "viewports": [
    {
      "id": "desktop",
      "label": "Desktop",
      "width": 1200,
      "isPrimary": true,
      "order": 0,
      "height": 900
    },
    {
      "id": "tablet",
      "label": "Tablet",
      "width": 1199,
      "isPrimary": false,
      "order": 1,
      "designWidth": 810,
      "height": 900
    },
    {
      "id": "mobile",
      "label": "Mobile",
      "width": 809,
      "isPrimary": false,
      "order": 2,
      "designWidth": 390,
      "height": 900
    }
  ],
  "positions": {
    "desktop": {
      "x": 0,
      "y": 0
    },
    "tablet": {
      "x": 1360,
      "y": 0
    },
    "mobile": {
      "x": 2330,
      "y": 0
    }
  }
} */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useScroll, useTransform, useInView, useMotionValue, animate } from 'framer-motion';
import { RevymeSplitText } from '@revyme/runtime';
import BrutalistButton from '@/components/BrutalistButton';
import ContentCard from '@/components/ContentCard';
import TagPill from '@/components/TagPill';
import BrutalistRadarMatrix from '@/components/BrutalistRadarMatrix';

export default function Page() {
  const [mobileNavOverlayOpen, setMobileNavOverlayOpen] = useState(false);

  useEffect(() => {
    if (!mobileNavOverlayOpen) return;
    const overlay = document.querySelector('[data-id="mobile-nav-overlay"]');
    if (!overlay) return;
    try {
      const links = overlay.querySelectorAll('a[href^="/"]');
      const router = typeof window !== 'undefined' ? (window['__revyme_router'] || window['__next_router'] || (window['next'] && window['next']['router']) || window['router']) : null;
      links.forEach((a) => {
        const mode = (typeof window !== 'undefined' && window.innerWidth < 810 && a.getAttribute('data-prefetch-mobile')) || (typeof window !== 'undefined' && window.innerWidth < 1200 && a.getAttribute('data-prefetch-tablet')) || a.getAttribute('data-prefetch');
        if (mode === 'off') return;
        const href = a.getAttribute('href');
        if (href && router && router.prefetch) router.prefetch(href, { kind: 'full' });
      });
    } catch {}
    const cfg = JSON.parse(overlay.getAttribute('data-overlay') || '{}');
    if (cfg.fill) overlay.style.backgroundColor = cfg.fill;
    if (cfg.zIndex != null) overlay.style.zIndex = String(cfg.zIndex);
    const onBackdrop = (e) => { if (e.target === overlay && cfg.dismissible !== false) setMobileNavOverlayOpen(false); };
    const onOverlayClick = (e) => {
      if (cfg.closeOnLink !== false) {
        const link = e.target && e.target.closest && e.target.closest('a[href], a, [data-link], [data-cms-nav], [data-cms-link], button, [role="button"]');
        if (link && overlay.contains(link)) setMobileNavOverlayOpen(false);
      }
    };
    overlay.addEventListener('mousedown', onBackdrop);
    overlay.addEventListener('click', onOverlayClick, true);
    const prevOverflow = document.body.style.overflow;
    if (cfg.pageScroll !== 'auto') document.body.style.overflow = 'hidden';
    return () => {
      overlay.removeEventListener('mousedown', onBackdrop);
      overlay.removeEventListener('click', onOverlayClick, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileNavOverlayOpen]);

  const { scrollY: heroImageCardSpeedScroll } = useScroll();
  const heroImageCardSpeedY = useTransform(heroImageCardSpeedScroll, (v) => v * (1 - 115 / 100));
  const featureImg_2Ref = useRef(null);
  const { scrollYProgress: featureImg_2Progress } = useScroll({ target: featureImg_2Ref, offset: ["start end", "end end"] });
  const featureImg_2Opacity = useTransform(featureImg_2Progress, [0, 1], [0.4, 1]);
  const featureImg_2Scale = useTransform(featureImg_2Progress, [0, 1], [0.92, 1]);
  const featureImg_1Ref = useRef(null);
  const { scrollYProgress: featureImg_1Progress } = useScroll({ target: featureImg_1Ref, offset: ["start end", "end end"] });
  const featureImg_1Opacity = useTransform(featureImg_1Progress, [0, 1], [0.4, 1]);
  const featureImg_1Scale = useTransform(featureImg_1Progress, [0, 1], [0.92, 1]);
  const heroImgStatusRef = useRef(null);
  const heroImgStatusLoopInView = useInView(heroImgStatusRef);
  const heroImgStatusLoopY = useMotionValue(0);
  useEffect(() => {
    if (heroImgStatusLoopInView) {
      const _c = animate(heroImgStatusLoopY, -4, { duration: 1.8, ease: 'easeInOut', repeat: Infinity });
      return () => _c.stop();
    }
  }, [heroImgStatusLoopInView]);

  return (
    <div
      data-id="root"
      data-name="Page"
      style={{
        position: 'relative',
        width: '100%',
        height: 'auto',
        backgroundColor: 'var(--color-canvas)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
      }}
    >
      <style>{`
        @media (max-width: 1199px) and (min-width: 809.02px) {
          [data-id="nav-links-row"] { display: none !important; }
          [data-id="nav-desktop-cta"] { display: none !important; }
          [data-id="mobile-nav-trigger"] { width: auto !important; height: auto !important; opacity: 1 !important; display: flex !important; padding: 8px 18px !important; }
          [data-id="hero-section"] { flex-direction: column !important; padding: 24px 24px 48px 24px !important; gap: 36px !important; }
          [data-id="hero-content-col"] { flex: 0 0 auto !important; width: 100% !important; }
          [data-id="hero-visual-col"] { flex: 0 0 auto !important; width: 100% !important; }
          [data-id="hero-display-heading"] { width: 100% !important; font-size: 48px !important; line-height: 1.15 !important; }
          [data-id="hero-desc-text"] { margin-top: 24px !important; font-size: 16px !important; }
          [data-id="integration-inner"] { flex-wrap: wrap !important; justify-content: center !important; gap: 20px !important; }
          [data-id="dark-section-heading"] { font-size: 52px !important; }
          [data-id="dark-showcase-grid"] { flex-direction: column !important; gap: 32px !important; }
          [data-id="feature-img-2"] { flex: 0 0 auto !important; width: 100% !important; max-width: 100% !important; height: 320px !important; }
          [data-id="radar-wrapper"] { flex: 0 0 auto !important; width: 100% !important; }
          [data-id="cases-heading"] { font-size: 52px !important; }
          [data-id="cases-cards-grid"] { flex-wrap: wrap !important; gap: 16px !important; }
          [data-id="case-card-1"] { flex: 0 0 auto !important; width: 100% !important; }
          [data-id="case-card-2"] { flex: 0 0 auto !important; width: 100% !important; }
          [data-id="case-card-3"] { flex: 0 0 auto !important; width: 100% !important; }
          [data-id="cases-feature-monolith-row"] { flex-direction: column !important; gap: 24px !important; }
          [data-id="feature-img-1"] { flex: 0 0 auto !important; width: 100% !important; max-width: 100% !important; height: 300px !important; }
          [data-id="case-card-featured"] { flex: 0 0 auto !important; width: 100% !important; }
        }
        @media (max-width: 809px) {
          [data-id="header-bar"] { height: 80px !important; padding: 0px 16px !important; }
          [data-id="nav-bar-pill"] { width: 100% !important; padding: 6px 12px 6px 18px !important; }
          [data-id="nav-links-row"] { display: none !important; }
          [data-id="nav-desktop-cta"] { display: none !important; }
          [data-id="mobile-nav-trigger"] { width: auto !important; height: auto !important; opacity: 1 !important; display: flex !important; padding: 8px 16px !important; }
          [data-id="hero-section"] { flex-direction: column !important; padding: 16px 16px 40px 16px !important; gap: 28px !important; }
          [data-id="hero-content-col"] { flex: 0 0 auto !important; width: 100% !important; }
          [data-id="hero-visual-col"] { flex: 0 0 auto !important; width: 100% !important; }
          [data-id="hero-display-heading"] { font-size: 42px !important; }
          [data-id="hero-desc-text"] { font-size: 15px !important; }
          [data-id="hero-cta-group"] { flex-direction: column !important; align-items: stretch !important; width: 100% !important; }
          [data-id="hero-meta-row"] { flex-direction: column !important; align-items: flex-start !important; gap: 8px !important; }
          [data-id="integration-inner"] { flex-direction: column !important; align-items: center !important; gap: 16px !important; }
          [data-id="dark-section-heading"] { font-size: 38px !important; }
          [data-id="dark-showcase-grid"] { flex-direction: column !important; gap: 24px !important; }
          [data-id="feature-img-2"] { flex: 0 0 auto !important; width: 100% !important; max-width: 100% !important; height: 240px !important; }
          [data-id="radar-wrapper"] { flex: 0 0 auto !important; width: 100% !important; }
          [data-id="cases-heading"] { font-size: 38px !important; }
          [data-id="cases-cards-grid"] { flex-direction: column !important; gap: 16px !important; }
          [data-id="case-card-1"] { flex: 0 0 auto !important; width: 100% !important; }
          [data-id="case-card-2"] { flex: 0 0 auto !important; width: 100% !important; }
          [data-id="case-card-3"] { flex: 0 0 auto !important; width: 100% !important; }
          [data-id="cases-feature-monolith-row"] { flex-direction: column !important; gap: 20px !important; }
          [data-id="feature-img-1"] { flex: 0 0 auto !important; width: 100% !important; max-width: 100% !important; height: 220px !important; }
          [data-id="case-card-featured"] { flex: 0 0 auto !important; width: 100% !important; }
          [data-id="footer-top-row"] { flex-direction: column !important; align-items: flex-start !important; gap: 24px !important; }
          [data-id="footer-heading"] { font-size: 32px !important; }
          [data-id="footer-bottom-row"] { flex-direction: column !important; align-items: flex-start !important; gap: 12px !important; }
          [data-id="ov-txt-1"] { font-size: 42px !important; }
          [data-id="ov-txt-2"] { font-size: 42px !important; }
          [data-id="ov-txt-3"] { font-size: 42px !important; }
          [data-id="ov-txt-4"] { font-size: 42px !important; }
        }
      `}</style>

      <div
        data-id="header-bar"
        style={{
          position: 'relative',
          width: '100%',
          height: '128px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0px 24px',
          order: '0',
          flex: '0 0 auto',
        }}
      >
        <div
          data-id="nav-bar-pill"
          style={{
            position: 'relative',
            width: 'auto',
            height: 'auto',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '28px',
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '48px',
            padding: '8px 12px 8px 24px',
            order: '0',
            flex: '0 0 auto',
          }}
        >
          <div
            data-id="nav-brand-box"
            style={{
              position: 'relative',
              width: 'auto',
              height: 'auto',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '8px',
              order: '0',
              flex: '0 0 auto',
            }}
          >
            <span
              data-id="nav-brand-title"
              style={{ width: 'auto', height: 'auto',
                position: 'relative',
                fontFamily: "var(--font-display)",
                fontSize: '24px',
                fontWeight: '800',
                color: 'var(--color-text)',
                letterSpacing: '-0.02em',
                order: '0',
                flex: '0 0 auto',
              }}
            >
              DAYOS
            </span>
          </div>

          <div
            data-id="nav-links-row"
            style={{
              position: 'relative',
              width: 'auto',
              height: 'auto',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '24px',
              order: '1',
              flex: '0 0 auto',
            }}
          >
            <span
              data-id="nav-item-1"
              style={{ width: 'auto', height: 'auto',
                position: 'relative',
                fontFamily: "var(--font-body)",
                fontSize: '14px',
                fontWeight: '500',
                color: 'var(--color-text-muted)',
                letterSpacing: '-0.01em',
                textTransform: 'uppercase',
                order: '0',
                flex: '0 0 auto',
              }}
            >
              PLATFORM
            </span>
            <span
              data-id="nav-item-2"
              style={{ width: 'auto', height: 'auto',
                position: 'relative',
                fontFamily: "var(--font-body)",
                fontSize: '14px',
                fontWeight: '500',
                color: 'var(--color-text-muted)',
                letterSpacing: '-0.01em',
                textTransform: 'uppercase',
                order: '1',
                flex: '0 0 auto',
              }}
            >
              SOLUTIONS
            </span>
            <span
              data-id="nav-item-3"
              style={{ width: 'auto', height: 'auto',
                position: 'relative',
                fontFamily: "var(--font-body)",
                fontSize: '14px',
                fontWeight: '500',
                color: 'var(--color-text-muted)',
                letterSpacing: '-0.01em',
                textTransform: 'uppercase',
                order: '2',
                flex: '0 0 auto',
              }}
            >
              MANIFESTO
            </span>
          </div>

          <div
            data-id="nav-desktop-cta"
            style={{
              position: 'relative',
              width: 'auto',
              height: 'auto',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'var(--color-text)',
              borderRadius: '32px',
              padding: '10px 20px',
              order: '2',
              flex: '0 0 auto',
            }}
          >
            <span
              data-id="nav-cta-label"
              style={{ width: 'auto', height: 'auto',
                position: 'relative',
                fontFamily: "var(--font-body)",
                fontSize: '13px',
                fontWeight: '600',
                color: 'var(--color-surface)',
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
                order: '0',
                flex: '0 0 auto',
              }}
            >
              SCHEDULE DEMO
            </span>
          </div>

          <button
            data-id="mobile-nav-trigger"
            data-overlay-trigger='{"targetId":"mobile-nav-overlay","trigger":"click","dismiss":"outside"}'
            onClick={() => setMobileNavOverlayOpen(!mobileNavOverlayOpen)}
            style={{
              position: 'relative',
              width: '0px',
              height: '0px',
              overflow: 'hidden',
              opacity: 0,
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'var(--color-surface-dark)',
              padding: '0px',
              borderRadius: '32px',
              border: 'none',
              cursor: 'pointer',
              order: '3',
              flex: '0 0 auto',
            }}
          >
            <span
              data-id="mb-trigger-text"
              style={{ width: 'auto', height: 'auto',
                position: 'relative',
                fontFamily: "var(--font-mono)",
                fontSize: '12px',
                fontWeight: '700',
                letterSpacing: '0.04em',
                color: 'var(--color-paper-white)',
                order: '0',
                flex: '0 0 auto',
              }}
            >
              MENU ☰
            </span>
          </button>
        </div>
      </div>

      <div
        data-id="hero-section"
        style={{
          height: 'auto',
          position: 'relative',
          width: '100%',
          maxWidth: '1200px',
          margin: '0 auto',
          padding: '24px 24px 80px 24px',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '48px',
          order: '1',
          flex: '0 0 auto',
        }}
      >
        <motion.div
          data-id="hero-content-col"
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          style={{ width: 'auto', height: 'auto',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '24px',
            order: '0',
            flex: '1 0 0px',
          }}
        >
          <TagPill
            data-id="hero-tag"
            text="COGNITION // 2026 ARCHITECTURE"
            style={{ position: 'relative', order: '0', flex: '0 0 auto' }}
          />
          <h1
            data-id="hero-display-heading"
            data-text-anim='{"animationType":"word","delay":0.05,"opacity":0,"y":20,"transition":{"type":"spring","stiffness":300,"damping":30},"mask":true,"trigger":"appear"}'
            style={{ width: 'auto', height: 'auto',
              position: 'relative',
              fontFamily: "var(--font-display)",
              fontSize: '110px',
              fontWeight: '800',
              lineHeight: '0.9',
              letterSpacing: '-0.03em',
              color: 'var(--color-text)',
              textTransform: 'uppercase',
              order: '1',
              flex: '0 0 auto',
            }}
          >
            <RevymeSplitText spec={{ animationType: "word", mask: true, trigger: "appear", opacity: 0, y: 20, delay: 0.05, transition: { type: "spring", stiffness: 300, damping: 30 } }}>
              AI FOR BUSINESS.
            </RevymeSplitText>
          </h1>
          <p
            data-id="hero-desc-text"
            style={{ width: 'auto', height: 'auto',
              position: 'relative',
              fontFamily: "var(--font-body)",
              fontSize: '18px',
              lineHeight: '1.4',
              color: 'var(--color-text-muted)',
              maxWidth: '520px',
              order: '2',
              flex: '0 0 auto',
            }}
          >
            Dayos deploys brutalist-editorial operational cognition directly into ERP, CRM, and financial data lakes with sub-second verified synthesis and zero hallucination drift.
          </p>
          <div
            data-id="hero-cta-group"
            style={{ width: 'auto', height: 'auto',
              position: 'relative',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '16px',
              order: '3',
              flex: '0 0 auto',
            }}
          >
            <BrutalistButton
              data-id="hero-primary-btn"
              label="SCHEDULE DEMO"
              style={{ position: 'relative', order: '0', flex: '0 0 auto' }}
            />
            <BrutalistButton
              data-id="hero-ghost-btn"
              label="READ MANIFESTO"
              initialVariant="ghost"
              style={{ position: 'relative', order: '1', flex: '0 0 auto' }}
            />
          </div>
          <div
            data-id="hero-meta-row"
            style={{ width: 'auto', height: 'auto',
              position: 'relative',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '24px',
              paddingTop: '16px',
              order: '4',
              flex: '0 0 auto',
            }}
          >
            <span
              data-id="hero-meta-1"
              style={{ width: 'auto', height: 'auto',
                position: 'relative',
                fontFamily: "var(--font-mono)",
                fontSize: '12px',
                color: 'var(--color-text-light)',
                order: '0',
                flex: '0 0 auto',
              }}
            >
              01 // SUB-SECOND LATENCY
            </span>
            <span
              data-id="hero-meta-2"
              style={{ width: 'auto', height: 'auto',
                position: 'relative',
                fontFamily: "var(--font-mono)",
                fontSize: '12px',
                color: 'var(--color-text-light)',
                order: '1',
                flex: '0 0 auto',
              }}
            >
              02 // SOC2 & ISO VERIFIED
            </span>
          </div>
        </motion.div>

        <div
          data-id="hero-visual-col"
          style={{ width: 'auto', height: 'auto',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            order: '1',
            flex: '1 0 0px',
          }}
        >
          <motion.div
            data-id="hero-image-card"
            whileHover={{ scale: 1.02 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            style={{
              height: 'auto',
              position: 'relative',
              width: '100%',
              maxWidth: '520px',
              borderRadius: '32px',
              overflow: 'hidden',
              backgroundColor: 'var(--color-canvas)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              order: '0',
              flex: '0 0 auto',
              y: heroImageCardSpeedY,
            }}
          >
            <img
              data-id="hero-3d-img"
              src="/images/hero-3d-object.png"
              alt="3D Concrete Cubes Modular Product Render"
              style={{
                position: 'relative',
                width: '100%',
                height: 'auto',
                maxHeight: '520px',
                objectFit: 'contain',
                display: 'block',
                order: '0',
                flex: '0 0 auto',
              }}
            />
            <motion.div
              data-id="hero-img-caption"
              whileHover={{ y: -2 }}
              style={{
                height: 'auto',
                position: 'relative',
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '16px',
                marginTop: '16px',
                order: '1',
                flex: '0 0 auto',
              }}
            >
              <span
                data-id="hero-img-label"
                style={{ width: 'auto', height: 'auto',
                  position: 'relative',
                  fontFamily: "var(--font-mono)",
                  fontSize: '12px',
                  color: 'var(--color-text)',
                  fontWeight: '500',
                  order: '0',
                  flex: '0 0 auto',
                }}
              >
                RENDER // 00 — PHYSICAL MONOLITH
              </span>
              <motion.span
                data-scroll-fx='{"loop":{"props":{"y":"-4"},"transition":{"duration":"1.8","ease":"easeInOut","repeat":"Infinity"}}}'
                ref={heroImgStatusRef}
                data-id="hero-img-status"
                style={{ width: 'auto', height: 'auto',
                  position: 'relative',
                  fontFamily: "var(--font-mono)",
                  fontSize: '11px',
                  color: 'var(--color-carbon-black)',
                  backgroundColor: 'var(--color-highlight)',
                  padding: '3px 8px',
                  borderRadius: '48px',
                  fontWeight: '600',
                  order: '1',
                  flex: '0 0 auto',
                  y: heroImgStatusLoopY,
                }}
              >
                LIVE PRODUCT
              </motion.span>
            </motion.div>
          </motion.div>
        </div>
      </div>

      <div
        data-id="integration-strip"
        style={{
          height: 'auto',
          position: 'relative',
          width: '100%',
          borderTop: '1px solid var(--color-border)',
          borderBottom: '1px solid var(--color-border)',
          padding: '24px 0px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'var(--color-canvas)',
          order: '2',
          flex: '0 0 auto',
        }}
      >
        <div
          data-id="integration-inner"
          style={{
            height: 'auto',
            position: 'relative',
            width: '100%',
            maxWidth: '1200px',
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0px 24px',
            order: '0',
            flex: '0 0 auto',
          }}
        >
          <motion.span
            data-id="int-1"
            whileHover={{ scale: 1.08, color: 'var(--color-text)' }}
            style={{ width: 'auto', height: 'auto',
              position: 'relative',
              fontFamily: "var(--font-mono)",
              fontSize: '13px',
              fontWeight: '600',
              color: 'var(--color-text-muted)',
              letterSpacing: '0.04em',
              cursor: 'pointer',
              order: '0',
              flex: '0 0 auto',
            }}
          >
            SAP // S4HANA
          </motion.span>
          <motion.span
            data-id="int-2"
            whileHover={{ scale: 1.08, color: 'var(--color-text)' }}
            style={{ width: 'auto', height: 'auto',
              position: 'relative',
              fontFamily: "var(--font-mono)",
              fontSize: '13px',
              fontWeight: '600',
              color: 'var(--color-text-muted)',
              letterSpacing: '0.04em',
              cursor: 'pointer',
              order: '1',
              flex: '0 0 auto',
            }}
          >
            ORACLE // CLOUD
          </motion.span>
          <motion.span
            data-id="int-3"
            whileHover={{ scale: 1.08, color: 'var(--color-text)' }}
            style={{ width: 'auto', height: 'auto',
              position: 'relative',
              fontFamily: "var(--font-mono)",
              fontSize: '13px',
              fontWeight: '600',
              color: 'var(--color-text-muted)',
              letterSpacing: '0.04em',
              cursor: 'pointer',
              order: '2',
              flex: '0 0 auto',
            }}
          >
            WORKDAY // HCM
          </motion.span>
          <motion.span
            data-id="int-4"
            whileHover={{ scale: 1.08, color: 'var(--color-text)' }}
            style={{ width: 'auto', height: 'auto',
              position: 'relative',
              fontFamily: "var(--font-mono)",
              fontSize: '13px',
              fontWeight: '600',
              color: 'var(--color-text-muted)',
              letterSpacing: '0.04em',
              cursor: 'pointer',
              order: '3',
              flex: '0 0 auto',
            }}
          >
            SALESFORCE // DATA CLOUD
          </motion.span>
          <motion.span
            data-id="int-5"
            whileHover={{ scale: 1.08, color: 'var(--color-text)' }}
            style={{ width: 'auto', height: 'auto',
              position: 'relative',
              fontFamily: "var(--font-mono)",
              fontSize: '13px',
              fontWeight: '600',
              color: 'var(--color-text-muted)',
              letterSpacing: '0.04em',
              cursor: 'pointer',
              order: '4',
              flex: '0 0 auto',
            }}
          >
            SNOWFLAKE // WAREHOUSE
          </motion.span>
        </div>
      </div>

      <div
        data-id="inverted-feature-section"
        style={{
          height: 'auto',
          position: 'relative',
          width: '100%',
          backgroundColor: 'var(--color-surface-dark)',
          padding: '96px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          order: '3',
          flex: '0 0 auto',
        }}
      >
        <div
          data-id="dark-section-inner"
          style={{
            height: 'auto',
            position: 'relative',
            width: '100%',
            maxWidth: '1200px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            order: '0',
            flex: '0 0 auto',
          }}
        >
          <TagPill
            data-id="dark-section-tag"
            text="INFRASTRUCTURE // DETERMINISTIC"
            style={{ position: 'relative', order: '0', flex: '0 0 auto' }}
          />
          <h2
            data-id="dark-section-heading"
            data-text-anim='{"animationType":"word","delay":0.04,"opacity":0,"y":20,"transition":{"type":"spring","stiffness":300,"damping":30},"mask":true,"trigger":"appear"}'
            style={{ width: 'auto', height: 'auto',
              position: 'relative',
              fontFamily: "var(--font-display)",
              fontSize: '80px',
              fontWeight: '800',
              lineHeight: '0.9',
              letterSpacing: '-0.03em',
              color: 'var(--color-paper-white)',
              textTransform: 'uppercase',
              marginTop: '20px',
              textAlign: 'center',
              order: '1',
              flex: '0 0 auto',
            }}
          >
            <RevymeSplitText spec={{ animationType: "word", mask: true, trigger: "appear", opacity: 0, y: 20, delay: 0.04, transition: { type: "spring", stiffness: 300, damping: 30 } }}>
              ZERO LATENCY. PROVABLE REASONING.
            </RevymeSplitText>
          </h2>
          <p
            data-id="dark-section-desc"
            style={{ width: 'auto', height: 'auto',
              position: 'relative',
              fontFamily: "var(--font-body)",
              fontSize: '16px',
              lineHeight: '1.5',
              color: 'var(--color-text-light)',
              maxWidth: '640px',
              marginTop: '16px',
              textAlign: 'center',
              order: '2',
              flex: '0 0 auto',
            }}
          >
            Eliminate probabilistic hallucinations. Dayos compiles complex enterprise workflows into formal state verifications executed at hardware speed.
          </p>

          <div
            data-id="dark-showcase-grid"
            style={{
              height: 'auto',
              position: 'relative',
              width: '100%',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '32px',
              marginTop: '64px',
              order: '3',
              flex: '0 0 auto',
            }}
          >
            <motion.img
              ref={featureImg_2Ref}
              data-id="feature-img-2"
              whileHover={{ scale: 1.03 }}
              transition={{ type: 'spring', stiffness: 300, damping: 22 }}
              src="/images/feature-monolith-2.jpg"
              alt="Dark Graphite 3D Architectural Cubes"
              style={{ width: 'auto',
                position: 'relative',
                maxWidth: '560px',
                height: '360px',
                objectFit: 'cover',
                borderRadius: '16px',
                border: '1px solid var(--color-border)',
                order: '0',
                flex: '1 0 0px',
                opacity: featureImg_2Opacity,
                scale: featureImg_2Scale,
              }}
            />
            <div
              data-id="radar-wrapper"
              style={{ width: 'auto',
                height: 'auto',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                order: '1',
                flex: '1 0 0px',
              }}
            >
              <BrutalistRadarMatrix
                data-id="telemetry-radar-widget"
                style={{ position: 'relative', width: '100%' }}
              />
            </div>
          </div>
        </div>
      </div>

      <div
        data-id="use-cases-section"
        style={{
          height: 'auto',
          position: 'relative',
          width: '100%',
          backgroundColor: 'var(--color-surface)',
          borderRadius: '64px 64px 0px 0px',
          padding: '96px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          order: '4',
          flex: '0 0 auto',
        }}
      >
        <div
          data-id="cases-inner"
          style={{
            height: 'auto',
            position: 'relative',
            width: '100%',
            maxWidth: '1200px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            order: '0',
            flex: '0 0 auto',
          }}
        >
          <TagPill
            data-id="cases-tag"
            text="USE CASE LIBRARY // ENTERPRISE"
            style={{ position: 'relative', order: '0', flex: '0 0 auto' }}
          />
          <h2
            data-id="cases-heading"
            data-text-anim='{"animationType":"word","delay":0.04,"opacity":0,"y":20,"transition":{"type":"spring","stiffness":300,"damping":30},"mask":true,"trigger":"appear"}'
            style={{ width: 'auto', height: 'auto',
              position: 'relative',
              fontFamily: "var(--font-display)",
              fontSize: '80px',
              fontWeight: '800',
              lineHeight: '0.9',
              letterSpacing: '-0.03em',
              color: 'var(--color-text)',
              textTransform: 'uppercase',
              marginTop: '20px',
              textAlign: 'center',
              order: '1',
              flex: '0 0 auto',
            }}
          >
            <RevymeSplitText spec={{ animationType: "word", mask: true, trigger: "appear", opacity: 0, y: 20, delay: 0.04, transition: { type: "spring", stiffness: 300, damping: 30 } }}>
              DEPLOYED CAPABILITIES.
            </RevymeSplitText>
          </h2>
          <p
            data-id="cases-desc"
            style={{ width: 'auto', height: 'auto',
              position: 'relative',
              fontFamily: "var(--font-body)",
              fontSize: '16px',
              lineHeight: '1.5',
              color: 'var(--color-text-muted)',
              maxWidth: '640px',
              marginTop: '16px',
              textAlign: 'center',
              order: '2',
              flex: '0 0 auto',
            }}
          >
            Modular operational units deployed across global manufacturing, high-frequency logistics, and regulatory compliance domains.
          </p>

          <motion.div
            data-id="cases-cards-grid"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ type: 'spring', stiffness: 240, damping: 24 }}
            style={{
              height: 'auto',
              position: 'relative',
              width: '100%',
              display: 'flex',
              flexDirection: 'row',
              gap: '24px',
              marginTop: '56px',
              order: '3',
              flex: '0 0 auto',
            }}
          >
            <ContentCard
              data-id="case-card-1"
              monoLabel="01 // FINANCE"
              tagText="TREASURY"
              title="AUTONOMOUS RECONCILIATION"
              description="Multi-currency ledger matching with automated dispute generation and compliance audit trails."
              style={{ position: 'relative', order: '0', flex: '1 0 0px' }}
            />
            <ContentCard
              data-id="case-card-2"
              monoLabel="02 // SUPPLY"
              tagText="LOGISTICS"
              title="DYNAMIC ROUTING FABRIC"
              description="Real-time freight rerouting predicting customs bottlenecks and maritime delays 72 hours ahead."
              style={{ position: 'relative', order: '1', flex: '1 0 0px' }}
            />
            <ContentCard
              data-id="case-card-3"
              monoLabel="03 // AUDIT"
              tagText="COMPLIANCE"
              title="REGULATORY VERIFICATION"
              description="Continuous deterministic compliance verification across SOX, GDPR, and ISO-27001 frameworks."
              style={{ position: 'relative', order: '2', flex: '1 0 0px' }}
            />
          </motion.div>

          <motion.div
            data-id="cases-feature-monolith-row"
            initial={{ opacity: 0, y: 36 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ type: 'spring', stiffness: 240, damping: 24 }}
            style={{
              height: 'auto',
              position: 'relative',
              width: '100%',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '36px',
              marginTop: '48px',
              order: '4',
              flex: '0 0 auto',
            }}
          >
            <motion.img
              ref={featureImg_1Ref}
              data-id="feature-img-1"
              whileHover={{ scale: 1.03 }}
              transition={{ type: 'spring', stiffness: 300, damping: 22 }}
              src="/images/feature-monolith-1.jpg"
              alt="3D Concrete and Mint Inlay Architecture"
              style={{ width: 'auto',
                position: 'relative',
                maxWidth: '480px',
                height: '320px',
                objectFit: 'cover',
                borderRadius: '32px',
                border: '1px solid var(--color-border)',
                order: '0',
                flex: '1 0 0px',
                opacity: featureImg_1Opacity,
                scale: featureImg_1Scale,
              }}
            />
            <ContentCard
              data-id="case-card-featured"
              initialVariant="inverted"
              monoLabel="04 // HIGH IMPACT"
              tagText="PRODUCTION"
              title="CONTINUOUS ADAPTIVE SYNTHESIS"
              description="Direct hardware synthesis accelerating complex business logic without refactoring underlying database schemas or ERP microservices."
              style={{ position: 'relative', order: '1', flex: '1 0 0px' }}
            />
          </motion.div>
        </div>
      </div>

      <div
        data-id="footer-section"
        style={{
          height: 'auto',
          position: 'relative',
          width: '100%',
          backgroundColor: 'var(--color-surface-dark)',
          padding: '64px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          order: '5',
          flex: '0 0 auto',
        }}
      >
        <div
          data-id="footer-inner"
          style={{
            height: 'auto',
            position: 'relative',
            width: '100%',
            maxWidth: '1200px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            order: '0',
            flex: '0 0 auto',
          }}
        >
          <div
            data-id="footer-top-row"
            style={{
              height: 'auto',
              position: 'relative',
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingBottom: '48px',
              borderBottom: '1px solid var(--color-border)',
              order: '0',
              flex: '0 0 auto',
            }}
          >
            <h3
              data-id="footer-heading"
              style={{ width: 'auto', height: 'auto',
                position: 'relative',
                fontFamily: "var(--font-display)",
                fontSize: '48px',
                fontWeight: '800',
                color: 'var(--color-paper-white)',
                lineHeight: '0.9',
                textTransform: 'uppercase',
                order: '0',
                flex: '0 0 auto',
              }}
            >
              DEPLOY DAYOS ON YOUR CLOUD.
            </h3>
            <motion.a
              data-id="footer-email-link"
              whileHover={{ scale: 1.06, y: -2 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              href="mailto:inquiries@dayos.ai"
              style={{ width: 'auto', height: 'auto',
                position: 'relative',
                fontFamily: "var(--font-mono)",
                fontSize: '16px',
                fontWeight: '700',
                color: 'var(--color-carbon-black)',
                backgroundColor: 'var(--color-highlight)',
                padding: '12px 24px',
                borderRadius: '48px',
                textDecoration: 'none',
                order: '1',
                flex: '0 0 auto',
              }}
            >
              INQUIRIES@DAYOS.AI
            </motion.a>
          </div>

          <div
            data-id="footer-bottom-row"
            style={{
              height: 'auto',
              position: 'relative',
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingTop: '32px',
              order: '1',
              flex: '0 0 auto',
            }}
          >
            <span
              data-id="footer-copyright"
              style={{ width: 'auto', height: 'auto',
                position: 'relative',
                fontFamily: "var(--font-mono)",
                fontSize: '12px',
                color: 'var(--color-text-light)',
                order: '0',
                flex: '0 0 auto',
              }}
            >
              © 2026 DAYOS INC. BRUTALIST ENTERPRISE EDITIONS.
            </span>
            <span
              data-id="footer-spec-badge"
              style={{ width: 'auto', height: 'auto',
                position: 'relative',
                fontFamily: "var(--font-mono)",
                fontSize: '12px',
                color: 'var(--color-accent)',
                order: '1',
                flex: '0 0 auto',
              }}
            >
              ALL RIGHTS RESERVED // LATENCY: 0.8MS
            </span>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {mobileNavOverlayOpen && (
          <motion.div
            key="mobile-nav-overlay"
            data-id="mobile-nav-overlay"
            data-name="Mobile Nav Fullscreen"
            data-overlay='{"type":"fixed","triggerId":"mobile-nav-trigger","side":"bottom","align":"center","offsetX":0,"offsetY":0}'
            initial={{ opacity: 0, scaleY: 0.05, y: -20 }}
            animate={{ opacity: 1, scaleY: 1, y: 0 }}
            exit={{ opacity: 0, scaleY: 0.05, y: -20 }}
            transition={{ type: 'spring', stiffness: 280, damping: 26 }}
            style={{
              position: 'fixed',
              left: '0px',
              top: '0px',
              width: '100%',
              height: '100vh',
              zIndex: '9999',
              backgroundColor: 'var(--color-surface-dark)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: '32px 24px',
              boxSizing: 'border-box',
              transformOrigin: 'top center',
              order: '6',
              flex: '0 0 auto',
            }}
          >
            <div
              data-id="ov-top-bar"
              style={{
                position: 'relative',
                width: '100%',
                height: 'auto',
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--color-border)',
                paddingBottom: '20px',
                order: '0',
                flex: '0 0 auto',
              }}
            >
              <div
                data-id="ov-brand-col"
                style={{
                  position: 'relative',
                  width: 'auto',
                  height: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  order: '0',
                  flex: '0 0 auto',
                }}
              >
                <span
                  data-id="ov-brand-name"
                  style={{ width: 'auto', height: 'auto',
                    position: 'relative',
                    fontFamily: "var(--font-display)",
                    fontSize: '32px',
                    fontWeight: '800',
                    color: 'var(--color-paper-white)',
                    letterSpacing: '-0.02em',
                    order: '0',
                    flex: '0 0 auto',
                  }}
                >
                  DAYOS
                </span>
                <span
                  data-id="ov-sub-spec"
                  style={{ width: 'auto', height: 'auto',
                    position: 'relative',
                    fontFamily: "var(--font-mono)",
                    fontSize: '11px',
                    color: 'var(--color-text-light)',
                    order: '1',
                    flex: '0 0 auto',
                  }}
                >
                  ENTERPRISE COGNITION // 2026
                </span>
              </div>

              <motion.button
                data-id="ov-close-btn"
                onClick={() => setMobileNavOverlayOpen(false)}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                style={{ width: 'auto', height: 'auto',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: 'var(--color-highlight)',
                  padding: '10px 22px',
                  borderRadius: '32px',
                  border: 'none',
                  cursor: 'pointer',
                  order: '1',
                  flex: '0 0 auto',
                }}
              >
                <span
                  data-id="ov-close-text"
                  style={{ width: 'auto', height: 'auto',
                    position: 'relative',
                    fontFamily: "var(--font-mono)",
                    fontSize: '12px',
                    fontWeight: '700',
                    color: 'var(--color-carbon-black)',
                    order: '0',
                    flex: '0 0 auto',
                  }}
                >
                  CLOSE ✕
                </span>
              </motion.button>
            </div>

            <div
              data-id="ov-links-container"
              style={{
                position: 'relative',
                width: '100%',
                height: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '28px',
                padding: '36px 0px',
                order: '1',
                flex: '0 0 auto',
              }}
            >
              <div
                data-id="ov-link-1"
                onClick={() => setMobileNavOverlayOpen(false)}
                style={{ width: 'auto', height: 'auto',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: '16px',
                  cursor: 'pointer',
                  order: '0',
                  flex: '0 0 auto',
                }}
              >
                <span
                  data-id="ov-num-1"
                  style={{ width: 'auto', height: 'auto',
                    position: 'relative',
                    fontFamily: "var(--font-mono)",
                    fontSize: '16px',
                    color: 'var(--color-accent)',
                    fontWeight: '700',
                    order: '0',
                    flex: '0 0 auto',
                  }}
                >
                  01 //
                </span>
                <span
                  data-id="ov-txt-1"
                  style={{ width: 'auto', height: 'auto',
                    position: 'relative',
                    fontFamily: "var(--font-display)",
                    fontSize: '56px',
                    fontWeight: '800',
                    color: 'var(--color-paper-white)',
                    lineHeight: '0.9',
                    letterSpacing: '-0.02em',
                    order: '1',
                    flex: '0 0 auto',
                  }}
                >
                  PLATFORM
                </span>
              </div>

              <div
                data-id="ov-link-2"
                onClick={() => setMobileNavOverlayOpen(false)}
                style={{ width: 'auto', height: 'auto',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: '16px',
                  cursor: 'pointer',
                  order: '1',
                  flex: '0 0 auto',
                }}
              >
                <span
                  data-id="ov-num-2"
                  style={{ width: 'auto', height: 'auto',
                    position: 'relative',
                    fontFamily: "var(--font-mono)",
                    fontSize: '16px',
                    color: 'var(--color-accent)',
                    fontWeight: '700',
                    order: '0',
                    flex: '0 0 auto',
                  }}
                >
                  02 //
                </span>
                <span
                  data-id="ov-txt-2"
                  style={{ width: 'auto', height: 'auto',
                    position: 'relative',
                    fontFamily: "var(--font-display)",
                    fontSize: '56px',
                    fontWeight: '800',
                    color: 'var(--color-paper-white)',
                    lineHeight: '0.9',
                    letterSpacing: '-0.02em',
                    order: '1',
                    flex: '0 0 auto',
                  }}
                >
                  CAPABILITIES
                </span>
              </div>

              <div
                data-id="ov-link-3"
                onClick={() => setMobileNavOverlayOpen(false)}
                style={{ width: 'auto', height: 'auto',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: '16px',
                  cursor: 'pointer',
                  order: '2',
                  flex: '0 0 auto',
                }}
              >
                <span
                  data-id="ov-num-3"
                  style={{ width: 'auto', height: 'auto',
                    position: 'relative',
                    fontFamily: "var(--font-mono)",
                    fontSize: '16px',
                    color: 'var(--color-accent)',
                    fontWeight: '700',
                    order: '0',
                    flex: '0 0 auto',
                  }}
                >
                  03 //
                </span>
                <span
                  data-id="ov-txt-3"
                  style={{ width: 'auto', height: 'auto',
                    position: 'relative',
                    fontFamily: "var(--font-display)",
                    fontSize: '56px',
                    fontWeight: '800',
                    color: 'var(--color-paper-white)',
                    lineHeight: '0.9',
                    letterSpacing: '-0.02em',
                    order: '1',
                    flex: '0 0 auto',
                  }}
                >
                  USE CASES
                </span>
              </div>

              <div
                data-id="ov-link-4"
                onClick={() => setMobileNavOverlayOpen(false)}
                style={{ width: 'auto', height: 'auto',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: '16px',
                  cursor: 'pointer',
                  order: '3',
                  flex: '0 0 auto',
                }}
              >
                <span
                  data-id="ov-num-4"
                  style={{ width: 'auto', height: 'auto',
                    position: 'relative',
                    fontFamily: "var(--font-mono)",
                    fontSize: '16px',
                    color: 'var(--color-accent)',
                    fontWeight: '700',
                    order: '0',
                    flex: '0 0 auto',
                  }}
                >
                  04 //
                </span>
                <span
                  data-id="ov-txt-4"
                  style={{ width: 'auto', height: 'auto',
                    position: 'relative',
                    fontFamily: "var(--font-display)",
                    fontSize: '56px',
                    fontWeight: '800',
                    color: 'var(--color-paper-white)',
                    lineHeight: '0.9',
                    letterSpacing: '-0.02em',
                    order: '1',
                    flex: '0 0 auto',
                  }}
                >
                  MANIFESTO
                </span>
              </div>
            </div>

            <div
              data-id="ov-bottom-bar"
              style={{
                position: 'relative',
                width: '100%',
                height: 'auto',
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderTop: '1px solid var(--color-border)',
                paddingTop: '24px',
                order: '2',
                flex: '0 0 auto',
              }}
            >
              <div
                data-id="ov-status-meta"
                style={{
                  position: 'relative',
                  width: 'auto',
                  height: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  order: '0',
                  flex: '0 0 auto',
                }}
              >
                <span
                  data-id="ov-latency-tag"
                  style={{ width: 'auto', height: 'auto',
                    position: 'relative',
                    fontFamily: "var(--font-mono)",
                    fontSize: '12px',
                    color: 'var(--color-accent)',
                    fontWeight: '600',
                    order: '0',
                    flex: '0 0 auto',
                  }}
                >
                  TELEMETRY // LATENCY: 0.8MS
                </span>
                <span
                  data-id="ov-security-tag"
                  style={{ width: 'auto', height: 'auto',
                    position: 'relative',
                    fontFamily: "var(--font-mono)",
                    fontSize: '11px',
                    color: 'var(--color-text-light)',
                    order: '1',
                    flex: '0 0 auto',
                  }}
                >
                  ZERO DRIFT // SOC2 TYPE II
                </span>
              </div>

              <motion.a
                data-id="ov-cta-link"
                href="mailto:inquiries@dayos.ai"
                onClick={() => setMobileNavOverlayOpen(false)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                style={{ width: 'auto', height: 'auto',
                  position: 'relative',
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '12px 24px',
                  borderRadius: '48px',
                  backgroundColor: 'var(--color-highlight)',
                  textDecoration: 'none',
                  order: '1',
                  flex: '0 0 auto',
                }}
              >
                <span
                  data-id="ov-cta-text"
                  style={{ width: 'auto', height: 'auto',
                    position: 'relative',
                    fontFamily: "var(--font-mono)",
                    fontSize: '13px',
                    fontWeight: '700',
                    color: 'var(--color-carbon-black)',
                    order: '0',
                    flex: '0 0 auto',
                  }}
                >
                  SCHEDULE DEMO →
                </span>
              </motion.a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
