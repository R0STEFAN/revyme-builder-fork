'use client';

/** @label "Projects Horizontal Pin-Scroll" */
/** @comment "Sticky horizontal gallery section smoothly translating projects on vertical scroll" */
/** @controls {
  "accentColor": { "type": "color", "label": "Accent Slide Color", "default": "#ff3300" },
  "cardBg": { "type": "color", "label": "Project Card Background", "default": "#ffffff" },
  "textColor": { "type": "color", "label": "Text Color", "default": "#09090b" }
} */

import React, { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

interface ProjectsProps {
  accentColor?: string;
  cardBg?: string;
  textColor?: string;
  style?: React.CSSProperties;
}

const PROJECTS_DATA = [
  {
    num: '01',
    title: 'Тату Студія',
    category: 'ВЕБ ДИЗАЙН // РОЗРОБКА',
    desc: 'Сучасний сайт для тату студії з акцентом на візуальну естетику, галерею робіт майстрів та форму онлайн-запису.',
    img: '/images/project-tattoo.webp',
    mockup: '/images/tattoozp.webp',
  },
  {
    num: '02',
    title: 'Портфоліо Дизайнера',
    category: 'UI/UX // КРЕАТИВНИЙ КОД',
    desc: 'Концептуальне портфоліо з кінетичною типографікою, мікроанімаціями та бездоганною швидкістю завантаження.',
    img: '/images/project-portfolio.webp',
    mockup: '/images/rostweb.webp',
  },
  {
    num: '03',
    title: 'Fashion & Barber',
    category: 'EDITORIAL // БРЕНДИНГ',
    desc: 'Елегантний та стильний вебсайт з акцентом на редакційну сітку, адаптивний контент та преміальні деталі.',
    img: '/images/project-barber.webp',
    mockup: '/images/gostre.webp',
  },
];

function ProjectsHorizontalScroll(props: ProjectsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  // 4 full width panels (1 title panel + 3 project panels) = translates -75%
  const x = useTransform(scrollYProgress, [0, 1], ['0%', '-75%']);

  const accent = props.accentColor || '#ff3300';
  const bg = props.cardBg || '#ffffff';
  const text = props.textColor || '#09090b';

  return (
    <div
      id="projects"
      ref={containerRef}
      data-id="projects-scroll-section"
      style={{
        position: 'relative',
        height: '400vh',
        width: '100%',
        boxSizing: 'border-box',
        ...props.style,
      }}
    >
      <div
        data-id="projects-sticky-frame"
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          width: '100%',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          backgroundColor: bg,
        }}
      >
        <motion.div
          data-id="projects-horizontal-track"
          style={{
            display: 'flex',
            flexDirection: 'row',
            width: '400vw',
            height: '100%',
            x,
            willChange: 'transform',
          }}
        >
          {/* SLIDE 0: Title Banner in Accent Orange */}
          <div
            data-id="projects-title-slide"
            style={{
              width: '100vw',
              height: '100%',
              flexShrink: 0,
              backgroundColor: accent,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '40px 80px',
              position: 'relative',
              boxSizing: 'border-box',
              borderRight: '1px solid rgba(0,0,0,0.15)',
            }}
          >
            <span
              style={{
                fontFamily: "'Unbounded', sans-serif",
                fontSize: '14px',
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#ffffff',
                marginBottom: '24px',
              }}
            >
              PORTFOLIO // CASE STUDIES
            </span>

            <h2
              style={{
                fontFamily: "'Unbounded', 'Impact', sans-serif",
                fontSize: 'clamp(48px, 9vw, 130px)',
                fontWeight: 900,
                lineHeight: 0.95,
                textTransform: 'uppercase',
                color: '#ffffff',
                margin: 0,
              }}
            >
              ОБРАНІ<br />ПРОЄКТИ.
            </h2>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '16px',
                marginTop: '48px',
                color: '#ffffff',
                fontFamily: "'Unbounded', sans-serif",
                fontSize: '16px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              <span>ГОРТАТИ ДАЛІ</span>
              <motion.span
                animate={{ x: [0, 16, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                style={{ fontSize: '28px' }}
              >
                →
              </motion.span>
            </div>
          </div>

          {/* SLIDES 1-3: Individual Projects */}
          {PROJECTS_DATA.map((proj, idx) => (
            <div
              key={idx}
              data-id={`project-slide-${idx + 1}`}
              style={{
                width: '100vw',
                height: '100%',
                flexShrink: 0,
                backgroundColor: bg,
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '60px 80px',
                position: 'relative',
                boxSizing: 'border-box',
                borderRight: '1px solid rgba(0,0,0,0.1)',
                gap: '60px',
              }}
            >
              {/* Left Details Column */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  maxWidth: '520px',
                  zIndex: 2,
                }}
              >
                <span
                  style={{
                    fontFamily: "'Unbounded', sans-serif",
                    fontSize: 'clamp(64px, 10vw, 140px)',
                    fontWeight: 900,
                    lineHeight: 1,
                    color: 'transparent',
                    WebkitTextStroke: '2px rgba(0,0,0,0.2)',
                    marginBottom: '16px',
                  }}
                >
                  {proj.num}
                </span>

                <span
                  style={{
                    fontFamily: "'Unbounded', sans-serif",
                    fontSize: '12px',
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: accent,
                    marginBottom: '12px',
                  }}
                >
                  {proj.category}
                </span>

                <h3
                  style={{
                    fontFamily: "'Unbounded', sans-serif",
                    fontSize: 'clamp(32px, 4.5vw, 64px)',
                    fontWeight: 800,
                    lineHeight: 1.05,
                    textTransform: 'uppercase',
                    color: text,
                    margin: '0 0 20px 0',
                  }}
                >
                  {proj.title}
                </h3>

                <p
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: '16px',
                    lineHeight: 1.7,
                    color: '#52525b',
                    margin: '0 0 32px 0',
                  }}
                >
                  {proj.desc}
                </p>

                <a
                  href="#contact"
                  data-hover-target="true"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 28px',
                    backgroundColor: text,
                    color: '#ffffff',
                    fontFamily: "'Unbounded', sans-serif",
                    fontSize: '12px',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    textDecoration: 'none',
                    borderRadius: '9999px',
                    transition: 'background-color 0.2s ease, transform 0.2s ease',
                  }}
                >
                  <span>ПЕРЕГЛЯНУТИ КЕЙС</span>
                  <span>→</span>
                </a>
              </div>

              {/* Right Image Mockup Preview */}
              <div
                data-hover-target="true"
                style={{
                  flex: '1 1 0px',
                  height: '78%',
                  maxHeight: '640px',
                  position: 'relative',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  backgroundColor: '#f1f3f5',
                  boxShadow: '0 20px 40px -10px rgba(0,0,0,0.12)',
                  border: '1px solid rgba(0,0,0,0.08)',
                }}
              >
                <img
                  src={proj.img}
                  alt={proj.title}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    transition: 'transform 0.4s cubic-bezier(0.2, 0.9, 0.3, 1)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                />
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

export default withResponsiveProps(ProjectsHorizontalScroll);
