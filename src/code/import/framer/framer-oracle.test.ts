import { describe, it, expect } from 'vitest';
import { checkFile } from '@/code/oracle/check-file';

describe('Verify Framer Exported Files Oracle Compliance', () => {
  const logoCode = `'use client';
import React, { useState, useEffect } from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

/** @name "Logo" */
/** @propMeta {
  "initialVariant": { "type": "enum", "label": "Variant", "options": ["default", "navbar"], "default": "default" }
} */

const variantConfig = [
  { name: 'default', label: 'Fit Text Variant', x: 0, y: 0, isPrimary: true },
  { name: 'navbar', label: 'Last Name Variant', x: 0, y: 100 }
];

const logoTextVariants = {
  default: {
    fontSize: 'clamp(80px, 18.5vw, 279px)',
    lineHeight: '0.8',
    letterSpacing: '-0.06em'
  },
  navbar: {
    fontSize: '20px',
    lineHeight: '1.2',
    letterSpacing: '-0.02em'
  }
};

function Logo({
  style,
  initialVariant = 'default',
  ...rest
}: {
  style?: React.CSSProperties;
  initialVariant?: 'default' | 'navbar';
  [key: string]: any;
}) {
  const [variant, setVariant] = useState(initialVariant);
  useEffect(() => { setVariant(initialVariant); }, [initialVariant]);

  return (
    <LayoutGroup>
      <motion.div
        data-id="logo-root"
        data-name="Logo"
        {...rest}
        style={{
          width: 'auto',
          height: 'auto',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          ...style
        }}
      >
        <motion.p
          data-id="logo-text"
          data-name="WALKER"
          variants={logoTextVariants}
          initial={initialVariant}
          animate={variant}
          style={{
            fontFamily: '"Zalando Sans", -apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: initialVariant === 'navbar' ? '20px' : 'clamp(80px, 18.5vw, 279px)',
            fontWeight: '800',
            lineHeight: initialVariant === 'navbar' ? '1.2' : '0.8',
            letterSpacing: initialVariant === 'navbar' ? '-0.02em' : '-0.06em',
            textTransform: 'uppercase',
            color: '#000000',
            position: 'relative',
            order: '0',
            flex: '0 0 auto',
            margin: '0px'
          }}
        >
          WALKER
        </motion.p>
      </motion.div>
    </LayoutGroup>
  );
}

export default withResponsiveProps(Logo);
`;

  const projectCardCode = `'use client';
import React, { useState, useEffect } from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

/** @name "Project Card" */
/** @propMeta {
  "initialVariant": { "type": "enum", "label": "Variant", "options": ["default", "hover"], "default": "default" },
  "client": { "type": "text", "label": "Client", "default": "Project Client" },
  "category": { "type": "text", "label": "Category", "default": "Branding" },
  "imageUrl": { "type": "image", "label": "Thumbnail Image", "default": "" }
} */

const variantConfig = [
  { name: 'default', label: 'Desktop', x: 0, y: 0, isPrimary: true },
  { name: 'hover', label: 'Desktop Hover', x: 0, y: 440 }
];

function ProjectCard({
  style,
  initialVariant = 'default',
  client = 'Project Client',
  category = 'Branding',
  imageUrl = "url('https://framerusercontent.com/images/dUKUMciUr5Py8VFQc6n4vMHFEvs.png')",
  ...rest
}: {
  style?: React.CSSProperties;
  initialVariant?: 'default' | 'hover';
  client?: string;
  category?: string;
  imageUrl?: string;
  [key: string]: any;
}) {
  const [variant, setVariant] = useState(initialVariant);
  useEffect(() => { setVariant(initialVariant); }, [initialVariant]);

  return (
    <LayoutGroup>
      <motion.div
        data-id="card-root"
        data-name="Project Card"
        onHoverStart={() => setVariant('hover')}
        onHoverEnd={() => setVariant('default')}
        {...rest}
        style={{
          width: 'auto',
          height: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          cursor: 'pointer',
          ...style
        }}
      >
        <motion.div
          data-id="card-media"
          data-name="Media Wrapper"
          whileHover={{ scale: 1.04 }}
          transition={{ duration: 0.3 }}
          style={{
            width: '100%',
            aspectRatio: '4 / 3',
            position: 'relative',
            overflow: 'hidden',
            borderRadius: '0px',
            order: '0',
            flex: '0 0 auto'
          }}
        >
          <motion.div
            data-id="card-image"
            data-name="Image"
            style={{
              width: '100%',
              height: '100%',
              backgroundImage: imageUrl,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              position: 'relative',
              order: '0',
              flex: '0 0 auto'
            }}
          />
        </motion.div>
        <motion.div
          data-id="card-info"
          data-name="Content Wrapper"
          style={{
            width: '100%',
            height: 'auto',
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            position: 'relative',
            order: '1',
            flex: '0 0 auto'
          }}
        >
          <motion.p
            data-id="card-client"
            data-name="Client"
            style={{
              fontFamily: '"Zalando Sans", -apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: '18px',
              fontWeight: '700',
              color: '#000000',
              position: 'relative',
              order: '0',
              flex: '0 0 auto',
              margin: '0px'
            }}
          >
            {client}
          </motion.p>
          <motion.p
            data-id="card-cat"
            data-name="Category"
            style={{
              fontFamily: '"Zalando Sans", -apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: '15px',
              fontWeight: '400',
              color: '#718096',
              position: 'relative',
              order: '1',
              flex: '0 0 auto',
              margin: '0px'
            }}
          >
            {category}
          </motion.p>
        </motion.div>
      </motion.div>
    </LayoutGroup>
  );
}

export default withResponsiveProps(ProjectCard);
`;

  const underlineLinkCode = `'use client';
import React, { useState, useEffect } from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

/** @name "Underline Link" */
/** @propMeta {
  "initialVariant": { "type": "enum", "label": "Variant", "options": ["default", "large"], "default": "default" },
  "label": { "type": "text", "label": "Label", "default": "Underline Link" },
  "href": { "type": "link", "label": "Link", "default": "#" }
} */

const variantConfig = [
  { name: 'default', label: 'Regular', x: 0, y: 0, isPrimary: true },
  { name: 'large', label: 'Large', x: 0, y: 80 }
];

function UnderlineLink({
  style,
  initialVariant = 'default',
  label = 'Underline Link',
  href = '#',
  ...rest
}: {
  style?: React.CSSProperties;
  initialVariant?: 'default' | 'large';
  label?: string;
  href?: string;
  [key: string]: any;
}) {
  const [variant, setVariant] = useState(initialVariant);
  useEffect(() => { setVariant(initialVariant); }, [initialVariant]);

  return (
    <LayoutGroup>
      <motion.div
        data-id="ulink-root"
        data-name="Underline Link"
        {...rest}
        style={{
          width: 'auto',
          height: 'auto',
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '2px',
          cursor: 'pointer',
          ...style
        }}
      >
        <motion.p
          data-id="ulink-label"
          data-name="Label"
          style={{
            fontFamily: '"Zalando Sans", -apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: initialVariant === 'large' ? '28px' : '18px',
            fontWeight: '500',
            color: '#000000',
            position: 'relative',
            order: '0',
            flex: '0 0 auto',
            margin: '0px'
          }}
        >
          {label}
        </motion.p>
        <motion.div
          data-id="ulink-line"
          data-name="Underline"
          style={{
            width: '100%',
            height: '1px',
            backgroundColor: '#000000',
            position: 'relative',
            order: '1',
            flex: '0 0 auto'
          }}
        />
      </motion.div>
    </LayoutGroup>
  );
}

export default withResponsiveProps(UnderlineLink);
`;

  const opacityLinkCode = `'use client';
import React, { useState, useEffect } from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

/** @name "Opacity Link" */
/** @propMeta {
  "label": { "type": "text", "label": "Label", "default": "Link" },
  "href": { "type": "link", "label": "Link", "default": "#" }
} */

const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true }
];

function OpacityLink({
  style,
  initialVariant = 'default',
  label = 'Link',
  href = '#',
  ...rest
}: {
  style?: React.CSSProperties;
  initialVariant?: string;
  label?: string;
  href?: string;
  [key: string]: any;
}) {
  return (
    <LayoutGroup>
      <motion.div
        data-id="oplink-root"
        data-name="Opacity Link"
        {...rest}
        style={{
          width: 'auto',
          height: 'auto',
          display: 'inline-flex',
          alignItems: 'center',
          cursor: 'pointer',
          ...style
        }}
      >
        <motion.p
          data-id="oplink-label"
          data-name="Label"
          style={{
            fontFamily: '"Zalando Sans", -apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: '15px',
            fontWeight: '400',
            color: '#000000',
            opacity: 0.85,
            position: 'relative',
            order: '0',
            flex: '0 0 auto',
            margin: '0px'
          }}
        >
          {label}
        </motion.p>
      </motion.div>
    </LayoutGroup>
  );
}

export default withResponsiveProps(OpacityLink);
`;

  const navigationBarCode = `'use client';
import React, { useState, useEffect } from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';
import Logo from '@/components/Logo';
import UnderlineLink from '@/components/UnderlineLink';

/** @name "Navigation Bar" */
/** @propMeta {
  "initialVariant": { "type": "enum", "label": "Variant", "options": ["default", "phone"], "default": "default" }
} */

const variantConfig = [
  { name: 'default', label: 'Desktop', x: 0, y: 0, isPrimary: true },
  { name: 'phone', label: 'Phone', x: 0, y: 120 }
];

function NavigationBar({
  style,
  initialVariant = 'default',
  ...rest
}: {
  style?: React.CSSProperties;
  initialVariant?: 'default' | 'phone';
  [key: string]: any;
}) {
  return (
    <LayoutGroup>
      <motion.div
        data-id="navbar-root"
        data-name="Navigation Bar"
        {...rest}
        style={{
          width: 'auto',
          height: 'auto',
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '24px 32px',
          ...style
        }}
      >
        <Logo
          initialVariant="navbar"
          data-id="nav-logo"
          data-name="WALKER"
          style={{ position: 'relative', order: '0', flex: '0 0 auto' }}
        />
        <UnderlineLink
          label="Menu"
          data-id="nav-menu"
          data-name="Menu"
          style={{ position: 'relative', order: '1', flex: '0 0 auto' }}
        />
      </motion.div>
    </LayoutGroup>
  );
}

export default withResponsiveProps(NavigationBar);
`;

  it('Logo component passes Oracle checkFile', () => {
    const violations = checkFile(logoCode, { kind: 'component', path: 'components/Logo.tsx' });
    expect(violations.filter(v => v.tier >= 2)).toEqual([]);
  });

  it('ProjectCard component passes Oracle checkFile', () => {
    const violations = checkFile(projectCardCode, { kind: 'component', path: 'components/ProjectCard.tsx' });
    expect(violations.filter(v => v.tier >= 2)).toEqual([]);
  });

  it('UnderlineLink component passes Oracle checkFile', () => {
    const violations = checkFile(underlineLinkCode, { kind: 'component', path: 'components/UnderlineLink.tsx' });
    expect(violations.filter(v => v.tier >= 2)).toEqual([]);
  });

  it('OpacityLink component passes Oracle checkFile', () => {
    const violations = checkFile(opacityLinkCode, { kind: 'component', path: 'components/OpacityLink.tsx' });
    expect(violations.filter(v => v.tier >= 2)).toEqual([]);
  });

  it('NavigationBar component passes Oracle checkFile', () => {
    const violations = checkFile(navigationBarCode, { kind: 'component', path: 'components/NavigationBar.tsx' });
    expect(violations.filter(v => v.tier >= 2)).toEqual([]);
  });

  it('WalkerPage passes Oracle checkFile', () => {
    const pageCode = `'use client';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 }, { "id": "tablet", "label": "Tablet", "width": 810, "height": "auto", "isPrimary": false, "order": 1 }, { "id": "mobile", "label": "Mobile", "width": 390, "height": "auto", "isPrimary": false, "order": 2 } ], "positions": { "desktop": { "x": 0, "y": 0 }, "tablet": { "x": 1360, "y": 0 }, "mobile": { "x": 2330, "y": 0 } } } */
import React from 'react';
import NavigationBar from '@/components/NavigationBar';
import Logo from '@/components/Logo';
import ProjectCard from '@/components/ProjectCard';
import UnderlineLink from '@/components/UnderlineLink';
import OpacityLink from '@/components/OpacityLink';

export default function WalkerPage() {
  return (
    <div
      data-id="root"
      data-name="Desktop"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: 'auto',
        backgroundColor: '#ffffff',
        position: 'relative'
      }}
    >
      <NavigationBar
        data-id="page-nav"
        data-name="Navigation Bar"
        style={{
          width: '100%',
          position: 'relative',
          order: '0',
          flex: '0 0 auto'
        }}
      />

      <main
        data-id="page-main"
        data-name="Main"
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          padding: '0px 32px',
          boxSizing: 'border-box',
          position: 'relative',
          order: '1',
          flex: '0 0 auto'
        }}
      >
        <section
          data-id="page-hero"
          data-name="Hero"
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            position: 'relative',
            order: '0',
            flex: '0 0 auto',
            marginBottom: '64px'
          }}
        >
          <div
            data-id="hero-logo-wrap"
            data-name="Logo Wrapper"
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'center',
              width: '100%',
              margin: '20px 0 40px 0',
              position: 'relative',
              order: '0',
              flex: '0 0 auto'
            }}
          >
            <Logo
              initialVariant="default"
              data-id="hero-logo"
              data-name="Fit Text Variant"
              style={{
                width: '100%',
                position: 'relative',
                order: '0',
                flex: '0 0 auto'
              }}
            />
          </div>

          <div
            data-id="hero-content"
            data-name="Content"
            style={{
              display: 'grid',
              gridTemplateColumns: '7fr 5fr',
              alignItems: 'end',
              gap: '24px',
              width: '100%',
              position: 'relative',
              order: '1',
              flex: '0 0 auto'
            }}
          >
            <div
              data-id="hero-h1-wrap"
              data-name="H1"
              style={{
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                order: '0',
                flex: '0 0 auto'
              }}
            >
              <h1
                data-id="hero-h1-text"
                data-name="H1 Text"
                style={{
                  fontFamily: '"Zalando Sans", -apple-system, BlinkMacSystemFont, sans-serif',
                  fontSize: '64px',
                  fontWeight: '500',
                  lineHeight: '1.075',
                  letterSpacing: '-0.04em',
                  color: '#000000',
                  margin: '0px',
                  position: 'relative',
                  order: '0',
                  flex: '0 0 auto'
                }}
              >
                Shaping meaningful brands through thoughtful design and digital experiences.
              </h1>
            </div>

            <div
              data-id="hero-details"
              data-name="Details"
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: '12px',
                position: 'relative',
                order: '1',
                flex: '0 0 auto'
              }}
            >
              <UnderlineLink
                label="Let\'s work together"
                data-id="hero-link"
                data-name="Underline Link"
                style={{
                  position: 'relative',
                  order: '0',
                  flex: '0 0 auto'
                }}
              />
              <span
                data-id="hero-arrow"
                data-name="Arrow"
                style={{
                  fontSize: '22px',
                  color: '#000000',
                  position: 'relative',
                  order: '1',
                  flex: '0 0 auto'
                }}
              >
                ↓
              </span>
            </div>
          </div>
        </section>

        <section
          data-id="page-projects"
          data-name="Projects"
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            position: 'relative',
            order: '1',
            flex: '0 0 auto',
            marginBottom: '80px'
          }}
        >
          <div
            data-id="projects-grid"
            data-name="Projects Grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '40px 32px',
              width: '100%',
              position: 'relative',
              order: '0',
              flex: '0 0 auto'
            }}
          >
            <ProjectCard
              client="Broken Alternatives"
              category="Branding"
              imageUrl="url('https://framerusercontent.com/images/dUKUMciUr5Py8VFQc6n4vMHFEvs.png')"
              data-id="card-1"
              data-name="Project Card"
              style={{
                width: '100%',
                position: 'relative',
                order: '0',
                flex: '0 0 auto'
              }}
            />
            <ProjectCard
              client="Elevated People"
              category="Motion"
              imageUrl="url('https://framerusercontent.com/images/zp1mTd4w5cRNdOGQ0R8WSyhCHg0.jpg')"
              data-id="card-2"
              data-name="Project Card"
              style={{
                width: '100%',
                position: 'relative',
                order: '1',
                flex: '0 0 auto'
              }}
            />
            <ProjectCard
              client="Studio Altera"
              category="Digital Experience"
              imageUrl="url('https://framerusercontent.com/images/XamhM8uQKyPCbGsiN3R7AwLw34.jpg')"
              data-id="card-3"
              data-name="Project Card"
              style={{
                width: '100%',
                position: 'relative',
                order: '2',
                flex: '0 0 auto'
              }}
            />
            <ProjectCard
              client="High Society Club"
              category="Digital Experience"
              imageUrl="url('https://framerusercontent.com/images/StStDkKf8tvZTsXF8sZt7SYVqfo.jpg')"
              data-id="card-4"
              data-name="Project Card"
              style={{
                width: '100%',
                position: 'relative',
                order: '3',
                flex: '0 0 auto'
              }}
            />
          </div>

          <div
            data-id="projects-see-all"
            data-name="See all work"
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'center',
              width: '100%',
              marginTop: '56px',
              position: 'relative',
              order: '1',
              flex: '0 0 auto'
            }}
          >
            <UnderlineLink
              initialVariant="large"
              label="→ See all work"
              data-id="see-all-link"
              data-name="Underline Link"
              style={{
                position: 'relative',
                order: '0',
                flex: '0 0 auto'
              }}
            />
          </div>
        </section>
      </main>

      <footer
        data-id="page-footer"
        data-name="Footer"
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          padding: '64px 32px 32px 32px',
          boxSizing: 'border-box',
          position: 'relative',
          order: '2',
          flex: '0 0 auto'
        }}
      >
        <div
          data-id="footer-top"
          data-name="Top Content"
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            width: '100%',
            marginBottom: '64px',
            position: 'relative',
            order: '0',
            flex: '0 0 auto'
          }}
        >
          <div
            data-id="footer-contact"
            data-name="Contact"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              position: 'relative',
              order: '0',
              flex: '0 0 auto'
            }}
          >
            <p
              data-id="contact-title"
              data-name="Get in touch"
              style={{
                fontFamily: '"Zalando Sans", -apple-system, BlinkMacSystemFont, sans-serif',
                fontSize: '22px',
                color: '#718096',
                margin: '0px',
                position: 'relative',
                order: '0',
                flex: '0 0 auto'
              }}
            >
              Get in touch
            </p>
            <UnderlineLink
              label="hello@walker.com"
              data-id="contact-email"
              data-name="Underline Link"
              style={{
                position: 'relative',
                order: '1',
                flex: '0 0 auto'
              }}
            />
          </div>

          <div
            data-id="footer-sitemap"
            data-name="Sitemap"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              position: 'relative',
              order: '1',
              flex: '0 0 auto'
            }}
          >
            <p
              data-id="sitemap-title"
              data-name="Sitemap Title"
              style={{
                fontFamily: '"Zalando Sans", -apple-system, BlinkMacSystemFont, sans-serif',
                fontSize: '13px',
                color: '#718096',
                margin: '0 0 6px 0',
                position: 'relative',
                order: '0',
                flex: '0 0 auto'
              }}
            >
              Sitemap
            </p>
            <OpacityLink label="Home" data-id="sm-home" data-name="Opacity Link" style={{ position: 'relative', order: '1', flex: '0 0 auto' }} />
            <OpacityLink label="Work" data-id="sm-work" data-name="Opacity Link" style={{ position: 'relative', order: '2', flex: '0 0 auto' }} />
            <OpacityLink label="About" data-id="sm-about" data-name="Opacity Link" style={{ position: 'relative', order: '3', flex: '0 0 auto' }} />
            <OpacityLink label="Contact" data-id="sm-contact" data-name="Opacity Link" style={{ position: 'relative', order: '4', flex: '0 0 auto' }} />
          </div>

          <div
            data-id="footer-socials"
            data-name="Socials"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              position: 'relative',
              order: '2',
              flex: '0 0 auto'
            }}
          >
            <p
              data-id="socials-title"
              data-name="Socials Title"
              style={{
                fontFamily: '"Zalando Sans", -apple-system, BlinkMacSystemFont, sans-serif',
                fontSize: '13px',
                color: '#718096',
                margin: '0 0 6px 0',
                position: 'relative',
                order: '0',
                flex: '0 0 auto'
              }}
            >
              Socials
            </p>
            <OpacityLink label="Instagram" data-id="soc-ig" data-name="Opacity Link" style={{ position: 'relative', order: '1', flex: '0 0 auto' }} />
            <OpacityLink label="LinkedIn" data-id="soc-li" data-name="Opacity Link" style={{ position: 'relative', order: '2', flex: '0 0 auto' }} />
            <OpacityLink label="Twitter" data-id="soc-tw" data-name="Opacity Link" style={{ position: 'relative', order: '3', flex: '0 0 auto' }} />
          </div>
        </div>

        <div
          data-id="footer-bottom"
          data-name="Bottom Content"
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            position: 'relative',
            order: '1',
            flex: '0 0 auto'
          }}
        >
          <div
            data-id="footer-logo-wrap"
            data-name="Logo Wrapper"
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'center',
              width: '100%',
              margin: '30px 0 30px 0',
              position: 'relative',
              order: '0',
              flex: '0 0 auto'
            }}
          >
            <Logo
              initialVariant="default"
              data-id="footer-logo"
              data-name="Fit Text Variant"
              style={{
                width: '100%',
                position: 'relative',
                order: '0',
                flex: '0 0 auto'
              }}
            />
          </div>

          <div
            data-id="footer-legal"
            data-name="Container"
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              borderTop: '1px solid #e2e8f0',
              paddingTop: '20px',
              position: 'relative',
              order: '1',
              flex: '0 0 auto'
            }}
          >
            <p
              data-id="footer-copy"
              data-name="Copyright"
              style={{
                fontSize: '13px',
                color: '#718096',
                margin: '0px',
                position: 'relative',
                order: '0',
                flex: '0 0 auto'
              }}
            >
              © 2026 Walker. All rights reserved.
            </p>
            <div
              data-id="footer-legal-links"
              data-name="Links Container"
              style={{
                display: 'flex',
                flexDirection: 'row',
                gap: '20px',
                position: 'relative',
                order: '1',
                flex: '0 0 auto'
              }}
            >
              <OpacityLink label="Privacy Policy" data-id="legal-priv" data-name="Opacity Link" style={{ position: 'relative', order: '0', flex: '0 0 auto' }} />
              <OpacityLink label="Terms of Service" data-id="legal-terms" data-name="Opacity Link" style={{ position: 'relative', order: '1', flex: '0 0 auto' }} />
            </div>
          </div>
        </div>
      </footer>

      <style>{\`
        @media (max-width: 1199px) {
          [data-id="page-main"] {
            padding: 0px 20px !important;
          }
          [data-id="hero-content"] {
            display: flex !important;
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 40px !important;
          }
          [data-id="hero-h1-wrap"] {
            width: 100% !important;
            max-width: 650px !important;
          }
          [data-id="hero-details"] {
            width: 100% !important;
            justify-content: space-between !important;
          }
          [data-id="projects-grid"] {
            grid-template-columns: repeat(1, minmax(0, 1fr)) !important;
            gap: 48px 20px !important;
          }
          [data-id="footer-top"] {
            flex-direction: column !important;
            gap: 48px !important;
          }
        }

        @media (max-width: 809px) {
          [data-id="page-main"] {
            padding: 0px 16px !important;
          }
          [data-id="hero-content"] {
            gap: 96px !important;
          }
          [data-id="hero-arrow"] {
            display: none !important;
          }
          [data-id="projects-grid"] {
            gap: 32px 20px !important;
          }
          [data-id="footer-legal"] {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 16px !important;
          }
        }
      \`}</style>
    </div>
  );
}
`;
    const violations = checkFile(pageCode, { kind: 'page', path: 'app/page.tsx' });
    expect(violations.filter(v => v.tier >= 2)).toEqual([]);
  });

  it('GlobalNavigation component passes Oracle checkFile', () => {
    const globalNavCode = `'use client';
import React from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';
import NavigationBar from '@/components/NavigationBar';

/** @name "Global Navigation" */
const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true }
];

function GlobalNavigation({
  style,
  ...rest
}: {
  style?: React.CSSProperties;
  [key: string]: any;
}) {
  return (
    <LayoutGroup>
      <motion.div
        data-id="global-nav-root"
        data-name="Global Navigation"
        {...rest}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '1200px',
          height: 'auto',
          backgroundColor: '#ffffff',
          position: 'absolute',
          ...style
        }}
      >
        <NavigationBar
          data-id="global-nav-bar"
          data-name="Navigation Bar"
          style={{
            width: '100%',
            position: 'relative',
            order: '0',
            flex: '0 0 auto'
          }}
        />
      </motion.div>
    </LayoutGroup>
  );
}

export default withResponsiveProps(GlobalNavigation);
`;
    const violations = checkFile(globalNavCode, { kind: 'component', path: 'components/GlobalNavigation.tsx' });
    expect(violations.filter(v => v.tier >= 2)).toEqual([]);
  });

  it('LayoutClient passes Oracle checkFile', () => {
    const layoutCode = `'use client';

/** @canvas { "viewports": [], "positions": {} } */
import React from 'react';
import NavigationBar from '@/components/NavigationBar';
import UnderlineLink from '@/components/UnderlineLink';

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-id="root"
      data-name="Layout"
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '800px',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <header
        data-id="tpl-header"
        data-name="Header"
        style={{
          display: 'flex',
          width: '100%',
          position: 'relative',
          order: '0',
          flex: '0 0 auto'
        }}
      >
        <NavigationBar
          data-id="tpl-nav"
          data-name="Navigation Bar"
          style={{
            width: '100%',
            position: 'relative',
            order: '0',
            flex: '0 0 auto'
          }}
        />
      </header>
      {children}
      <footer
        data-id="tpl-footer"
        data-name="Footer"
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          padding: '64px 32px 32px 32px',
          boxSizing: 'border-box',
          position: 'relative',
          order: '1',
          flex: '0 0 auto'
        }}
      >
        <div
          data-id="tpl-footer-top"
          data-name="Top Content"
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            width: '100%',
            marginBottom: '64px',
            position: 'relative',
            order: '0',
            flex: '0 0 auto'
          }}
        >
          <div
            data-id="tpl-footer-contact"
            data-name="Contact"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              position: 'relative',
              order: '0',
              flex: '0 0 auto'
            }}
          >
            <p
              data-id="tpl-contact-title"
              data-name="Get in touch"
              style={{
                fontFamily: 'var(--typo-h2-font)',
                fontSize: 'var(--typo-h2-size)',
                color: '#718096',
                margin: '0px',
                position: 'relative',
                order: '0',
                flex: '0 0 auto'
              }}
            >
              Get in touch
            </p>
            <UnderlineLink
              label="hello@walker.com"
              data-id="tpl-contact-email"
              data-name="Underline Link"
              style={{
                position: 'relative',
                order: '1',
                flex: '0 0 auto'
              }}
            />
          </div>
        </div>
      </footer>
    </div>
  );
}
`;
    const violations = checkFile(layoutCode, { kind: 'template', path: 'app/LayoutClient.tsx' });
    expect(violations.filter(v => v.tier >= 2)).toEqual([]);
  });
});
