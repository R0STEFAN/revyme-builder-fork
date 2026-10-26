'use client';

import React from 'react';
import { useTranslations } from 'next-intl';

export default function GalleryClient() {
  const t = useTranslations('gallery');
  return (
    <div>
      <h1 data-testid="page-title">{t('title')}</h1>
      <p data-testid="page-content">Welcome to the gallery.</p>
    </div>
  );
}
