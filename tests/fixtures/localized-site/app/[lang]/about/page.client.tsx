'use client';

import React from 'react';
import { useTranslations } from 'next-intl';

export default function AboutClient() {
  const t = useTranslations('about');
  return (
    <div>
      <h1 data-testid="page-title">{t('title')}</h1>
      <p data-testid="page-content">About our team.</p>
    </div>
  );
}
