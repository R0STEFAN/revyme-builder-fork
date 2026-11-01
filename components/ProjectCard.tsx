'use client';

/** @name "ProjectCard" */
/** @propMeta {"client":{"type":"plainText"},"category":{"type":"plainText"},"imageUrl":{"type":"plainText"},"href":{"type":"plainText"}} */

import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
  { name: 'hover', label: 'Hover', x: 0, y: 600 },
];

function ProjectCard({
  style,
  client = 'Broken Alternatives',
  category = 'Branding',
  imageUrl = 'https://framerusercontent.com/images/dUKUMciUr5Py8VFQc6n4vMHFEvs.png',
  href = '/works/broken-alternatives',
  initialVariant = 'default',
}: {
  style?: React.CSSProperties;
  client?: string;
  category?: string;
  imageUrl?: string;
  href?: string;
  initialVariant?: string;
}) {
  return (
    <div
      data-id="card-root"
      style={{
        width: 'auto',
        height: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        gap: '16px',
        ...style,
      }}
    >
      <div
        data-id="card-media-wrap"
        style={{
          order: '0',
          flex: '0 0 auto',
          width: '100%',
          aspectRatio: '1.3333333333333333',
          backgroundImage: `url(${imageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '0px',
        }}
      />
      <div
        data-id="card-info-row"
        style={{
          order: '1',
          flex: '0 0 auto',
          width: '100%',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'relative',
        }}
      >
        <p
          data-id="card-client-text"
          style={{
            order: '0',
            flex: '0 0 auto',
            fontFamily: '"Zalando Sans", -apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: '18px',
            fontWeight: '500',
            lineHeight: '1.4',
            letterSpacing: '-0.02em',
            color: '#000000',
            margin: '0',
            position: 'relative',
          }}
        >
          {client}
        </p>
        <p
          data-id="card-category-text"
          style={{
            order: '1',
            flex: '0 0 auto',
            fontFamily: '"Zalando Sans", -apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: '14px',
            fontWeight: '400',
            lineHeight: '1.4',
            color: '#666666',
            margin: '0',
            position: 'relative',
          }}
        >
          {category}
        </p>
      </div>
    </div>
  );
}

export default withResponsiveProps(ProjectCard);
