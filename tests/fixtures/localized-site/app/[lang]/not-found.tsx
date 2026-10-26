'use client';

import React from 'react';
import { useTranslations } from 'next-intl';

export default function LocalizedNotFound() {
  const t = useTranslations('notFound');
  return (
    <div data-testid="custom-404">
      <h1>404</h1>
      <p>{t('title')}</p>
    </div>
  );
}
