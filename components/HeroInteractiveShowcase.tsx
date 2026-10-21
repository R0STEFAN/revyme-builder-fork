'use client';

/** @label "Interactive Hero Showcase" */
/** @comment "Cinematic interactive hero section cycling through 4 service business miniatures with 4-second sequential 3D assembly, letter-by-letter convergence, and section-wide 3D cursor tracking" */
/** @defaultWidth 1200 */
/** @defaultHeight 820 */
/** @controls {
  "autoPlay": { "type": "toggle", "label": "Auto-Cycle Niches", "default": true },
  "cycleDuration": { "type": "number", "label": "Cycle Duration (s)", "min": 6, "max": 20, "default": 9 },
  "headingPrefix": { "type": "text", "label": "Heading Prefix", "default": "Створимо сайт для вашого бізнесу — " }
} */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

interface HeroShowcaseProps {
  autoPlay?: boolean;
  cycleDuration?: number;
  headingPrefix?: string;
  style?: React.CSSProperties;
}

interface BusinessNiche {
  id: string;
  tabLabel: string;
  nicheName: string;
  tagline: string;
  description: string;
  accentColor: string;
  accentGlow: string;
  badgeBg: string;
  borderColor: string;
  mockupBg: string;
  domain: string;
  logo: string;
  miniBadge: string;
  miniHeadline: string;
  miniSubtext: string;
  miniCtaText: string;
  badgePill1: string;
  badgePill2: string;
  image: string;
}

const BUSINESS_NICHES: BusinessNiche[] = [
  {
    id: 'detailing',
    tabLabel: '01. Авто детейлінг',
    nicheName: 'Детейлінг студії',
    tagline: 'ПРЕМІУМ ДОГЛЯД ЗА АВТО',
    description: 'Підкресліть статус вашого сервісу. Інтерактивні галереї до/після, онлайн-калькулятор бронеплівки та запис на полірування у 2 кліки.',
    accentColor: '#38bdf8',
    accentGlow: 'rgba(56, 189, 248, 0.35)',
    badgeBg: 'rgba(56, 189, 248, 0.18)',
    borderColor: 'rgba(56, 189, 248, 0.45)',
    mockupBg: '#090e17',
    domain: 'apex-detailing.ua',
    logo: 'APEX DETAIL',
    miniBadge: '✦ 9H НАНОКЕРАМІКА',
    miniHeadline: 'Дзеркальний глянець та захист від сколів',
    miniSubtext: 'Преміальні матеріали, сертифіковані майстри та гарантія 3 роки на всі види покриттів.',
    miniCtaText: 'Записатись на детейлінг',
    badgePill1: '🛡️ Гарантія 3 роки • 1200+ авто',
    badgePill2: '★ 4.9 Рейтинг клієнтів',
    image: 'https://images.unsplash.com/photo-1601362840469-51e4d8d58785?auto=format&fit=crop&w=1000&q=80',
  },
  {
    id: 'dental',
    tabLabel: '02. Стоматологія',
    nicheName: 'Стоматологічної клініки',
    tagline: 'ЕСТЕТИЧНА МЕДИЦИНА',
    description: 'Викликайте довіру з першого погляду. Презентація лікарів, 3D візуалізація лікування та прозорий прайс без прихованих платежів.',
    accentColor: '#22d3ee',
    accentGlow: 'rgba(34, 211, 238, 0.35)',
    badgeBg: 'rgba(34, 211, 238, 0.18)',
    borderColor: 'rgba(34, 211, 238, 0.45)',
    mockupBg: '#08131a',
    domain: 'dent-aesthetics.ua',
    logo: 'DENT AESTHETICS',
    miniBadge: '✨ ЦИФРОВА СТОМАТОЛОГІЯ',
    miniHeadline: 'Бездоганна посмішка без болю та стресу',
    miniSubtext: 'Сучасне обладнання, комп’ютерна анестезія та повний цикл лікування в одному місці.',
    miniCtaText: 'Онлайн-запис на прийом',
    badgePill1: '🦷 3D Томографія • Без болю',
    badgePill2: '15 000+ задоволених пацієнтів',
    image: 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=1000&q=80',
  },
  {
    id: 'solar',
    tabLabel: '03. Сонячна енергія',
    nicheName: 'Сонячної енергетики',
    tagline: 'ЕНЕРГОНЕЗАЛЕЖНІСТЬ ПІД КЛЮЧ',
    description: 'Продавайте складні інженерні рішення просто. Інтерактивний калькулятор окупності, конфігуратор потужності та заявки безпосередньо у CRM.',
    accentColor: '#facc15',
    accentGlow: 'rgba(250, 204, 21, 0.32)',
    badgeBg: 'rgba(250, 204, 21, 0.18)',
    borderColor: 'rgba(250, 204, 21, 0.45)',
    mockupBg: '#14140a',
    domain: 'helios-solar.ua',
    logo: 'HELIOS ENERGY',
    miniBadge: '☀️ СЕС ПІД КЛЮЧ ЗА 14 ДНІВ',
    miniHeadline: 'Власна сонячна станція із зеленою генерацією',
    miniSubtext: 'Автономність для будинку чи підприємства. Повний супровід від проєкту до запуску.',
    miniCtaText: 'Розрахувати окупність',
    badgePill1: '⚡ Окупність від 3.2 років',
    badgePill2: 'До -85% витрат на електрику',
    image: 'https://images.unsplash.com/photo-1509391365360-2e959784a276?auto=format&fit=crop&w=1000&q=80',
  },
  {
    id: 'tattoo',
    tabLabel: '04. Тату студія',
    nicheName: 'Тату студії',
    tagline: 'АВТОРСЬКЕ МИСТЕЦТВО',
    description: 'Створіть незабутній візуальний стиль. Галерея робіт за стилями (Realism, Blackwork, Fine-line), портфоліо майстрів та бронювання консультацій.',
    accentColor: '#fb7185',
    accentGlow: 'rgba(251, 113, 133, 0.35)',
    badgeBg: 'rgba(251, 113, 133, 0.18)',
    borderColor: 'rgba(251, 113, 133, 0.45)',
    mockupBg: '#180a12',
    domain: 'ink-iron-tattoo.ua',
    logo: 'INK & IRON',
    miniBadge: '🩸 АВТОРСЬКИЙ ЕСКІЗ',
    miniHeadline: 'Мистецтво на шкірі, що передає ваш характер',
    miniSubtext: 'Стерильне обладнання преміум-класу, майстри зі світовим визнанням та індивідуальні ескізи.',
    miniCtaText: 'Забронювати сеанс',
    badgePill1: '100% Стерильність • EU пігменти',
    badgePill2: '★ Топ-майстри з досвідом 7+ р.',
    image: 'https://images.unsplash.com/photo-1598371839696-5c5bb00bdc28?auto=format&fit=crop&w=1000&q=80',
  },
];

// Silk-smooth ease curve (zero snapping, zero bounce jitter)
const SMOOTH_EASE = [0.16, 1, 0.3, 1];

function HeroInteractiveShowcase({
  autoPlay = true,
  cycleDuration = 9,
  headingPrefix = 'Створимо сайт для вашого бізнесу — ',
  style,
}: HeroShowcaseProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  // Mouse offset across entire section: -0.5 to 0.5
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });

  // Mobile responsiveness and aspect-ratio scaling state
  const mockupWrapperRef = useRef<HTMLDivElement>(null);
  const [mockupScale, setMockupScale] = useState(1);
  const [isMobile, setIsMobile] = useState(false);

  const activeBusiness = BUSINESS_NICHES[currentIndex];
  const startTimeRef = useRef<number>(Date.now());

  // Continuous auto-rotation without pause on hover
  useEffect(() => {
    if (!autoPlay) return;

    startTimeRef.current = Date.now() - (progress / 100) * (cycleDuration * 1000);

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const total = cycleDuration * 1000;
      const currentProgress = Math.min((elapsed / total) * 100, 100);

      if (currentProgress >= 100) {
        setProgress(0);
        setCurrentIndex((prev) => (prev + 1) % BUSINESS_NICHES.length);
        startTimeRef.current = Date.now();
      } else {
        setProgress(currentProgress);
      }
    }, 40);

    return () => clearInterval(interval);
  }, [autoPlay, currentIndex, cycleDuration, progress]);

  // Dynamic scale calculation preserving exact desktop aspect ratio (520 : 400) on phones
  useEffect(() => {
    const updateDimensions = () => {
      const mob = typeof window !== 'undefined' ? window.innerWidth <= 868 : false;
      setIsMobile(mob);

      if (mockupWrapperRef.current) {
        const containerWidth = mockupWrapperRef.current.clientWidth;
        if (containerWidth > 0) {
          const baseWidth = 520;
          let s = Math.min(1, containerWidth / baseWidth);
          if (mob && typeof window !== 'undefined') {
            // Keep miniature within ~32% of phone screen height so all controls fit in 1 viewport
            const maxAllowedHeight = Math.min(230, window.innerHeight * 0.32);
            const scaleByHeight = maxAllowedHeight / 400;
            s = Math.max(0.42, Math.min(s, scaleByHeight));
          }
          setMockupScale(s);
        }
      }
    };

    updateDimensions();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && mockupWrapperRef.current) {
      ro = new ResizeObserver(updateDimensions);
      ro.observe(mockupWrapperRef.current);
    }

    window.addEventListener('resize', updateDimensions);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', updateDimensions);
    };
  }, []);

  const selectNiche = (index: number) => {
    setCurrentIndex(index);
    setProgress(0);
    startTimeRef.current = Date.now();
  };

  // Mouse movement tracker across the ENTIRE HERO SECTION
  const handleSectionMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setMouseOffset({ x, y });
  };

  const handleSectionMouseLeave = () => {
    setMouseOffset({ x: 0, y: 0 });
  };

  return (
    <div
      data-id="hero-interactive-showcase-root"
      onMouseMove={handleSectionMouseMove}
      onMouseLeave={handleSectionMouseLeave}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: isMobile ? '100svh' : '840px',
        height: isMobile ? '100svh' : 'auto',
        maxHeight: isMobile ? '100svh' : 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: isMobile ? 'space-between' : 'center',
        padding: isMobile ? '10px 16px 12px 16px' : '60px 32px 80px 32px',
        boxSizing: 'border-box',
        backgroundColor: '#09090b',
        color: '#ffffff',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        overflow: 'hidden',
        ...style,
      }}
    >
      <style>{`
        @media (max-width: 868px) {
          [data-id="hero-interactive-showcase-root"] {
            min-height: 100svh !important;
            height: 100svh !important;
            max-height: 100svh !important;
            padding: 10px 14px 12px 14px !important;
            justify-content: space-between !important;
          }
          [data-id="hero-columns-container"] {
            flex-direction: column !important;
            gap: 6px !important;
            height: 100% !important;
            justify-content: space-between !important;
          }
          [data-id="hero-right-column"] {
            order: 1 !important;
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          [data-id="hero-left-column"] {
            order: 2 !important;
            width: 100% !important;
            align-items: center !important;
            text-align: center !important;
          }
          [data-id="hero-main-title"] {
            font-size: clamp(17px, 4.4vw, 21px) !important;
            line-height: 1.15 !important;
            margin-bottom: 4px !important;
            text-align: center !important;
          }
          [data-id="hero-desc-wrapper"] {
            min-height: 34px !important;
            margin-bottom: 6px !important;
          }
          [data-id="hero-actions-row"] {
            justify-content: center !important;
            margin-bottom: 8px !important;
            gap: 8px !important;
          }
          [data-id="hero-switcher-tabs"] {
            margin: 0 auto !important;
            gap: 5px !important;
          }
        }
      `}</style>

      {/* Background ambient glowing mesh */}
      <div
        data-id="ambient-glow"
        style={{
          position: 'absolute',
          top: '-10%',
          right: '5%',
          width: isMobile ? '380px' : '700px',
          height: isMobile ? '380px' : '700px',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${activeBusiness.accentGlow} 0%, rgba(9, 9, 11, 0) 70%)`,
          pointerEvents: 'none',
          transition: 'background 0.8s ease',
          zIndex: 0,
        }}
      />
      <div
        data-id="ambient-subtle-glow"
        style={{
          position: 'absolute',
          bottom: '-15%',
          left: '0%',
          width: isMobile ? '300px' : '550px',
          height: isMobile ? '300px' : '550px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255, 255, 255, 0.03) 0%, rgba(9, 9, 11, 0) 70%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* Main Responsive Layout: On mobile flex-direction is column with Mockup on top, text underneath */}
      <div
        data-id="hero-columns-container"
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: '1280px',
          height: isMobile ? '100%' : 'auto',
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: isMobile ? 'space-between' : 'space-between',
          gap: isMobile ? '8px' : '48px',
          flexWrap: isMobile ? 'nowrap' : 'wrap',
        }}
      >
        {/* RIGHT COLUMN (MOCKUP): Sits at the TOP on mobile (order: 1), right on desktop (order: 2) */}
        <div
          data-id="hero-right-column"
          style={{
            order: isMobile ? 1 : 2,
            flex: isMobile ? '0 0 auto' : '1 1 520px',
            width: '100%',
            maxWidth: isMobile ? '480px' : 'none',
            minWidth: isMobile ? '0' : '320px',
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            perspective: '1200px',
            perspectiveOrigin: '50% 50%',
            transformStyle: 'preserve-3d',
            padding: isMobile ? '0' : '30px 10px',
            margin: isMobile ? '0' : '0',
          }}
        >
          {/* Mockup Aspect-Ratio Scaler Wrapper: Preserves exact 520:400 aspect ratio at all screen sizes */}
          <div
            ref={mockupWrapperRef}
            data-id="hero-mockup-wrapper"
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '520px',
              height: `${Math.round(400 * mockupScale)}px`,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-start',
              perspective: '1200px',
              perspectiveOrigin: '50% 50%',
              transformStyle: 'preserve-3d',
              margin: '0 auto',
            }}
          >
            <div
              data-id="hero-mockup-aspect-scaler"
              style={{
                width: '520px',
                height: '400px',
                transform: `scale(${mockupScale})`,
                transformOrigin: 'top center',
                transformStyle: 'preserve-3d',
                position: 'relative',
                flexShrink: 0,
              }}
            >
              {/* Main Browser Window Frame with 3D Tilt reacting to cursor movement */}
              <motion.div
                data-id="mini-browser-frame"
                animate={{
                  rotateX: -mouseOffset.y * 22,
                  rotateY: mouseOffset.x * 26,
                }}
                transition={{
                  type: 'spring',
                  stiffness: 140,
                  damping: 22,
                }}
                style={{
                  position: 'relative',
                  width: '520px',
                  height: '400px',
                  borderRadius: '22px',
                  boxShadow: `0 30px 70px -12px rgba(0, 0, 0, 0.85), 0 0 45px ${activeBusiness.accentGlow}`,
                  display: 'flex',
                  flexDirection: 'column',
                  transformStyle: 'preserve-3d',
                  transition: 'box-shadow 0.6s ease',
                }}
              >
                {/* Physical 3D Base Floor (translateZ: 0px) */}
                <div
                  data-id="mini-browser-floor"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '22px',
                    backgroundColor: activeBusiness.mockupBg,
                    border: `1.5px solid ${activeBusiness.borderColor}`,
                    transform: 'translateZ(0px)',
                    transformStyle: 'preserve-3d',
                    pointerEvents: 'none',
                    overflow: 'hidden',
                    transition: 'background-color 0.6s ease, border-color 0.6s ease',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.14) 1px, transparent 1px)',
                      backgroundSize: '20px 20px',
                      opacity: 0.8,
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: `radial-gradient(ellipse at 80% 20%, ${activeBusiness.accentGlow} 0%, rgba(0,0,0,0) 70%)`,
                    }}
                  />
                </div>

                {/* Top bar of browser: translateZ: 25px */}
                <div
                  data-id="mini-browser-topbar"
                  style={{
                    height: '40px',
                    padding: '0 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    borderTopLeftRadius: '22px',
                    borderTopRightRadius: '22px',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    transform: 'translateZ(25px)',
                    transformStyle: 'preserve-3d',
                    zIndex: 10,
                  }}
                >
                  {/* Traffic Light Dots */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
                    <div style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#f59e0b' }} />
                    <div style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                  </div>

                  {/* URL address badge */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '3px 10px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(0, 0, 0, 0.6)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      fontSize: '10.5px',
                      color: 'rgba(255, 255, 255, 0.7)',
                    }}
                  >
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M3 5V3.5C3 1.84 4.34 0.5 6 0.5C7.66 0.5 9 1.84 9 3.5V5H10C10.55 5 11 5.45 11 6V10.5C11 11.05 10.55 11.5 10 11.5H2C1.45 11.5 1 11.05 1 10.5V6C1 5.45 1.45 5 2 5H3ZM4.5 5H7.5V3.5C7.5 2.67 6.83 2 6 2C5.17 2 4.5 2.67 4.5 3.5V5Z"
                        fill="currentColor"
                      />
                    </svg>
                    <span>{activeBusiness.domain}</span>
                  </div>

                  {/* Live 3D Badge */}
                  <div
                    style={{
                      fontSize: '9.5px',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      color: activeBusiness.accentColor,
                      textTransform: 'uppercase',
                    }}
                  >
                    3D LIVE
                  </div>
                </div>

                {/* Inner Interactive Canvas Container (height 360px) */}
                <div
                  data-id="mini-mockup-body"
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: '360px',
                    padding: '16px 18px',
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                    transformStyle: 'preserve-3d',
                  }}
                >
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeBusiness.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.4, ease: 'easeInOut' }}
                      style={{
                        position: 'relative',
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        transformStyle: 'preserve-3d',
                      }}
                    >
                      {/* 1. MINI NAVBAR: Flies in in 3D SPACE at z: 40px */}
                      <motion.div
                        data-id="mockup-mini-navbar"
                        initial={{ y: -100, z: 40, opacity: 0 }}
                        animate={{ y: 0, z: 40, opacity: 1 }}
                        transition={{
                          duration: 0.85,
                          ease: SMOOTH_EASE,
                          delay: 0.6,
                        }}
                        style={{
                          position: 'relative',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          borderRadius: '10px',
                          backgroundColor: 'rgba(18, 20, 28, 0.92)',
                          border: '1px solid rgba(255, 255, 255, 0.16)',
                          marginBottom: '12px',
                          transformStyle: 'preserve-3d',
                          boxShadow: '0 14px 28px -4px rgba(0, 0, 0, 0.75)',
                          zIndex: 10,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div
                            style={{
                              width: '18px',
                              height: '18px',
                              borderRadius: '4px',
                              backgroundColor: activeBusiness.accentColor,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '10px',
                              fontWeight: 900,
                              color: '#09090b',
                            }}
                          >
                            ⚡
                          </div>
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontWeight: 800,
                              letterSpacing: '0.04em',
                              color: '#ffffff',
                            }}
                          >
                            {activeBusiness.logo}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '9.5px', color: 'rgba(255, 255, 255, 0.6)' }}>Послуги</span>
                          <span style={{ fontSize: '9.5px', color: 'rgba(255, 255, 255, 0.6)' }}>Прайс</span>
                          <div
                            style={{
                              padding: '3px 8px',
                              borderRadius: '5px',
                              backgroundColor: activeBusiness.accentColor,
                              color: '#09090b',
                              fontSize: '9.5px',
                              fontWeight: 700,
                            }}
                          >
                            Запис
                          </div>
                        </div>
                      </motion.div>

                      {/* MINI HERO CONTENT GRID */}
                      <div
                        style={{
                          position: 'relative',
                          display: 'grid',
                          gridTemplateColumns: '1.15fr 1fr',
                          gap: '14px',
                          alignItems: 'center',
                          flex: '1 1 auto',
                          transformStyle: 'preserve-3d',
                        }}
                      >
                        {/* LEFT CONTENT OF MINI MOCKUP */}
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            transformStyle: 'preserve-3d',
                          }}
                        >
                          {/* 2. MINI BADGE: Flies in at z: 40px */}
                          <motion.div
                            data-id="mockup-mini-badge"
                            initial={{ x: -100, y: -40, z: 40, opacity: 0 }}
                            animate={{ x: 0, y: 0, z: 40, opacity: 1 }}
                            transition={{
                              duration: 0.85,
                              ease: SMOOTH_EASE,
                              delay: 1.2,
                            }}
                            style={{
                              padding: '4px 9px',
                              borderRadius: '7px',
                              backgroundColor: activeBusiness.badgeBg,
                              border: `1.5px solid ${activeBusiness.borderColor}`,
                              color: activeBusiness.accentColor,
                              fontSize: '9.5px',
                              fontWeight: 800,
                              letterSpacing: '0.06em',
                              marginBottom: '8px',
                              transformStyle: 'preserve-3d',
                              boxShadow: '0 8px 16px rgba(0, 0, 0, 0.6)',
                              zIndex: 12,
                            }}
                          >
                            {activeBusiness.miniBadge}
                          </motion.div>

                          {/* 3. MINI HEADLINE & SUBTEXT CARD: Flies in at z: 40px */}
                          <motion.div
                            data-id="mockup-mini-text-card"
                            initial={{ x: -120, z: 40, opacity: 0 }}
                            animate={{ x: 0, z: 40, opacity: 1 }}
                            transition={{
                              duration: 0.85,
                              ease: SMOOTH_EASE,
                              delay: 1.7,
                            }}
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              borderRadius: '12px',
                              backgroundColor: 'rgba(15, 18, 25, 0.88)',
                              border: '1px solid rgba(255, 255, 255, 0.14)',
                              marginBottom: '10px',
                              transformStyle: 'preserve-3d',
                              boxShadow: '0 14px 28px rgba(0, 0, 0, 0.75)',
                              zIndex: 14,
                            }}
                          >
                            <h3
                              data-id="mockup-mini-title"
                              style={{
                                fontSize: '14.5px',
                                fontWeight: 800,
                                lineHeight: '1.25',
                                color: '#ffffff',
                                margin: '0 0 4px 0',
                              }}
                            >
                              {activeBusiness.miniHeadline}
                            </h3>
                            <p
                              data-id="mockup-mini-subtext"
                              style={{
                                fontSize: '10.5px',
                                lineHeight: '1.4',
                                color: 'rgba(255, 255, 255, 0.7)',
                                margin: 0,
                              }}
                            >
                              {activeBusiness.miniSubtext}
                            </p>
                          </motion.div>

                          {/* 4. MINI CTA BUTTON: Flies in at z: 40px */}
                          <motion.div
                            data-id="mockup-mini-cta"
                            initial={{ y: 80, z: 40, opacity: 0 }}
                            animate={{ y: 0, z: 40, opacity: 1 }}
                            transition={{
                              duration: 0.85,
                              ease: SMOOTH_EASE,
                              delay: 2.8,
                            }}
                            style={{
                              padding: '8px 16px',
                              borderRadius: '8px',
                              backgroundColor: activeBusiness.accentColor,
                              color: '#09090b',
                              fontSize: '10.5px',
                              fontWeight: 800,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              transformStyle: 'preserve-3d',
                              boxShadow: `0 14px 26px -4px rgba(0, 0, 0, 0.8), 0 0 14px ${activeBusiness.accentGlow}`,
                              cursor: 'pointer',
                              zIndex: 18,
                            }}
                          >
                            <span>{activeBusiness.miniCtaText}</span>
                            <span>→</span>
                          </motion.div>
                        </div>

                        {/* RIGHT VISUAL OF MINI MOCKUP */}
                        <div
                          style={{
                            position: 'relative',
                            width: '100%',
                            height: '170px',
                            transformStyle: 'preserve-3d',
                          }}
                        >
                          {/* 5. MINI HERO IMAGE CARD: Flies in at z: 40px */}
                          <motion.div
                            data-id="mockup-mini-image"
                            initial={{ x: 140, y: 100, z: 40, opacity: 0 }}
                            animate={{ x: 0, y: 0, z: 40, opacity: 1 }}
                            transition={{
                              duration: 0.85,
                              ease: SMOOTH_EASE,
                              delay: 2.3,
                            }}
                            style={{
                              position: 'relative',
                              width: '100%',
                              height: '100%',
                              borderRadius: '14px',
                              overflow: 'hidden',
                              border: '1.5px solid rgba(255, 255, 255, 0.2)',
                              transformStyle: 'preserve-3d',
                              boxShadow: '0 18px 34px -6px rgba(0, 0, 0, 0.8)',
                              zIndex: 15,
                            }}
                          >
                            <img
                              src={activeBusiness.image}
                              alt={activeBusiness.nicheName}
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                display: 'block',
                              }}
                            />
                            <div
                              style={{
                                position: 'absolute',
                                inset: 0,
                                background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 60%)',
                              }}
                            />
                          </motion.div>

                          {/* 6. FLOATING PILL 2: HIGHEST BADGE OVER PHOTO AT z: 110px! */}
                          <motion.div
                            data-id="mockup-floating-pill-2"
                            initial={{ x: 100, y: -60, z: 110, opacity: 0 }}
                            animate={{ x: 0, y: 0, z: 110, opacity: 1 }}
                            transition={{
                              duration: 0.85,
                              ease: SMOOTH_EASE,
                              delay: 3.8,
                            }}
                            style={{
                              position: 'absolute',
                              top: '-14px',
                              right: '-14px',
                              padding: '7px 14px',
                              borderRadius: '10px',
                              backgroundColor: '#0c0f17',
                              border: `2px solid ${activeBusiness.accentColor}`,
                              fontSize: '11px',
                              fontWeight: 800,
                              color: '#ffffff',
                              whiteSpace: 'nowrap',
                              transformStyle: 'preserve-3d',
                              boxShadow: `0 24px 40px rgba(0, 0, 0, 0.95), 0 0 22px ${activeBusiness.accentGlow}`,
                              zIndex: 40,
                            }}
                          >
                            {activeBusiness.badgePill2}
                          </motion.div>
                        </div>
                      </div>

                      {/* 7. FLOATING PILL 1: Flies in at z: 40px */}
                      <motion.div
                        data-id="mockup-floating-pill-1"
                        initial={{ x: -100, y: 60, z: 40, opacity: 0 }}
                        animate={{ x: 0, y: 0, z: 40, opacity: 1 }}
                        transition={{
                          duration: 0.85,
                          ease: SMOOTH_EASE,
                          delay: 3.3,
                        }}
                        style={{
                          position: 'relative',
                          marginTop: '12px',
                          alignSelf: 'flex-start',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '7px',
                          padding: '6px 14px',
                          borderRadius: '9px',
                          backgroundColor: 'rgba(16, 20, 28, 0.95)',
                          border: '1.5px solid rgba(255, 255, 255, 0.2)',
                          fontSize: '10.5px',
                          fontWeight: 700,
                          color: 'rgba(255, 255, 255, 0.95)',
                          transformStyle: 'preserve-3d',
                          boxShadow: '0 14px 26px rgba(0, 0, 0, 0.75)',
                          zIndex: 20,
                        }}
                      >
                        <span>{activeBusiness.badgePill1}</span>
                      </motion.div>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
            </div>
          </div>
        </div>

        {/* LEFT COLUMN: Headings, dynamic title, description, actions, switcher (UNDERNEATH MOCKUP ON MOBILE) */}
        <div
          data-id="hero-left-column"
          style={{
            order: isMobile ? 2 : 1,
            flex: isMobile ? '1 1 auto' : '1 1 500px',
            width: '100%',
            maxWidth: isMobile ? '480px' : 'none',
            minWidth: isMobile ? '0' : '320px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: isMobile ? 'center' : 'flex-start',
            textAlign: isMobile ? 'center' : 'left',
            justifyContent: isMobile ? 'space-between' : 'flex-start',
          }}
        >
          {/* Status pill with pulsing live dot */}
          <div
            data-id="hero-status-pill"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: isMobile ? '6px' : '8px',
              padding: isMobile ? '3px 10px' : '6px 14px',
              borderRadius: '9999px',
              backgroundColor: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              marginBottom: isMobile ? '4px' : '24px',
              backdropFilter: 'blur(8px)',
            }}
          >
            <span
              style={{
                width: isMobile ? '6px' : '8px',
                height: isMobile ? '6px' : '8px',
                borderRadius: '50%',
                backgroundColor: activeBusiness.accentColor,
                boxShadow: `0 0 10px ${activeBusiness.accentColor}`,
                transition: 'background-color 0.4s ease, box-shadow 0.4s ease',
              }}
            />
            <span
              style={{
                fontSize: isMobile ? '10px' : '12px',
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'rgba(255, 255, 255, 0.8)',
              }}
            >
              {activeBusiness.tagline}
            </span>
          </div>

          {/* Main heading with LETTER-BY-LETTER CONVERGING ANIMATION */}
          <h1
            data-id="hero-main-title"
            style={{
              fontSize: isMobile ? 'clamp(17px, 4.4vw, 21px)' : 'clamp(32px, 4vw, 54px)',
              fontWeight: 800,
              lineHeight: isMobile ? 1.15 : 1.18,
              letterSpacing: '-0.02em',
              color: '#ffffff',
              margin: isMobile ? '0 0 4px 0' : '0 0 20px 0',
              textAlign: isMobile ? 'center' : 'left',
            }}
          >
            {headingPrefix}
            <span
              style={{
                display: 'inline-block',
                position: 'relative',
              }}
            >
              <AnimatePresence mode="wait">
                <motion.span
                  key={activeBusiness.id}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  variants={{
                    hidden: {},
                    visible: {
                      transition: {
                        staggerChildren: 0.04,
                        delayChildren: 0.05,
                      },
                    },
                    exit: {
                      transition: {
                        staggerChildren: 0.015,
                        staggerDirection: -1,
                      },
                    },
                  }}
                  style={{
                    display: 'inline-flex',
                    flexWrap: 'wrap',
                    position: 'relative',
                    justifyContent: isMobile ? 'center' : 'flex-start',
                  }}
                >
                  {/* Origin focal point dot that bursts when letters fly out */}
                  <motion.span
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: [0, 2.5, 0], opacity: [0, 1, 0] }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    style={{
                      position: 'absolute',
                      left: isMobile ? '6px' : '10px',
                      top: '50%',
                      width: isMobile ? '10px' : '14px',
                      height: isMobile ? '10px' : '14px',
                      borderRadius: '50%',
                      backgroundColor: activeBusiness.accentColor,
                      boxShadow: `0 0 20px 5px ${activeBusiness.accentColor}`,
                      pointerEvents: 'none',
                      transform: 'translate(-50%, -50%)',
                      zIndex: 2,
                    }}
                  />

                  {activeBusiness.nicheName.split('').map((char, index) => {
                    const originOffset = isMobile ? (6 - index * 12) : (10 - index * 22);
                    return (
                      <motion.span
                        key={`${activeBusiness.id}-c-${index}`}
                        variants={{
                          hidden: {
                            x: originOffset,
                            y: isMobile ? 18 : 35,
                            scale: 0.1,
                            opacity: 0,
                            rotate: -40 + (index % 4) * 20,
                            filter: 'blur(8px)',
                          },
                          visible: {
                            x: 0,
                            y: 0,
                            scale: 1,
                            opacity: 1,
                            rotate: 0,
                            filter: 'blur(0px)',
                            transition: {
                              type: 'spring',
                              stiffness: 280,
                              damping: 24,
                              mass: 0.7,
                            },
                          },
                          exit: {
                            y: isMobile ? -14 : -22,
                            scale: 0.3,
                            opacity: 0,
                            filter: 'blur(6px)',
                            transition: { duration: 0.2 },
                          },
                        }}
                        style={{
                          display: 'inline-block',
                          whiteSpace: char === ' ' ? 'pre' : 'normal',
                          color: activeBusiness.accentColor,
                          textShadow: `0 0 24px ${activeBusiness.accentGlow}`,
                        }}
                      >
                        {char === ' ' ? '\u00A0' : char}
                      </motion.span>
                    );
                  })}
                </motion.span>
              </AnimatePresence>
            </span>
          </h1>

          {/* Dynamic subtext tailored to niche */}
          <div
            data-id="hero-desc-wrapper"
            style={{
              minHeight: isMobile ? '34px' : '80px',
              marginBottom: isMobile ? '6px' : '32px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <AnimatePresence mode="wait">
              <motion.p
                key={activeBusiness.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35 }}
                style={{
                  fontSize: isMobile ? '11.5px' : '16px',
                  lineHeight: isMobile ? '1.35' : '1.65',
                  color: 'rgba(255, 255, 255, 0.65)',
                  margin: '0 auto',
                  maxWidth: isMobile ? '380px' : '500px',
                  textAlign: isMobile ? 'center' : 'left',
                  display: isMobile ? '-webkit-box' : 'block',
                  WebkitLineClamp: isMobile ? 2 : 'unset',
                  WebkitBoxOrient: isMobile ? 'vertical' : 'unset',
                  overflow: isMobile ? 'hidden' : 'visible',
                }}
              >
                {activeBusiness.description}
              </motion.p>
            </AnimatePresence>
          </div>

          {/* Action buttons */}
          <div
            data-id="hero-actions-row"
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: isMobile ? 'center' : 'flex-start',
              gap: isMobile ? '8px' : '14px',
              marginBottom: isMobile ? '8px' : '40px',
              flexWrap: 'wrap',
            }}
          >
            <a
              href="#contact"
              data-id="hero-primary-cta"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: isMobile ? '6px' : '10px',
                padding: isMobile ? '8px 16px' : '14px 28px',
                borderRadius: isMobile ? '10px' : '12px',
                backgroundColor: activeBusiness.accentColor,
                color: '#09090b',
                fontWeight: 700,
                fontSize: isMobile ? '12px' : '15px',
                textDecoration: 'none',
                boxShadow: `0 6px 20px ${activeBusiness.accentGlow}`,
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0px) scale(1)';
              }}
            >
              <span>Обговорити проєкт</span>
              <svg width={isMobile ? "13" : "16"} height={isMobile ? "13" : "16"} viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 8H13M13 8L8.5 3.5M13 8L8.5 12.5"
                  stroke="#09090b"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>

            <a
              href="#portfolio"
              data-id="hero-secondary-cta"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: isMobile ? '8px 14px' : '14px 24px',
                borderRadius: isMobile ? '10px' : '12px',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                fontWeight: 600,
                fontSize: isMobile ? '12px' : '15px',
                textDecoration: 'none',
                transition: 'background-color 0.2s ease, border-color 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.24)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
              }}
            >
              <span>Усі кейси</span>
            </a>
          </div>

          {/* Interactive Niche Selector with live progress bars */}
          <div
            data-id="hero-switcher-tabs"
            style={{
              width: '100%',
              maxWidth: isMobile ? '400px' : '520px',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: isMobile ? '5px' : '10px',
              margin: isMobile ? '0 auto' : '0',
            }}
          >
            {BUSINESS_NICHES.map((niche, idx) => {
              const isActive = idx === currentIndex;
              return (
                <button
                  key={niche.id}
                  onClick={() => selectNiche(idx)}
                  data-id={`niche-tab-${idx}`}
                  style={{
                    position: 'relative',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    padding: isMobile ? '5px 8px' : '12px 14px',
                    borderRadius: isMobile ? '8px' : '10px',
                    backgroundColor: isActive
                      ? 'rgba(255, 255, 255, 0.07)'
                      : 'rgba(255, 255, 255, 0.02)',
                    border: `1px solid ${
                      isActive ? niche.borderColor : 'rgba(255, 255, 255, 0.07)'
                    }`,
                    cursor: 'pointer',
                    transition: 'all 0.25s ease',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      fontSize: isMobile ? '10px' : '13px',
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? '#ffffff' : 'rgba(255, 255, 255, 0.55)',
                      marginBottom: isMobile ? '3px' : '6px',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      width: '100%',
                    }}
                  >
                    {niche.tabLabel}
                  </span>

                  {/* Progress Line */}
                  <div
                    style={{
                      width: '100%',
                      height: isMobile ? '2px' : '3px',
                      borderRadius: '999px',
                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: isActive ? `${progress}%` : idx < currentIndex ? '100%' : '0%',
                        backgroundColor: niche.accentColor,
                        borderRadius: '999px',
                        transition: isActive ? 'none' : 'width 0.3s ease',
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default withResponsiveProps(HeroInteractiveShowcase);
