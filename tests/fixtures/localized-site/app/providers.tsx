'use client';

import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import ukMessages from '../messages/uk.json';
import enMessages from '../messages/en.json';

const messagesByLocale: Record<string, any> = {
  uk: ukMessages,
  en: enMessages,
};

export function Providers({
  children,
  locale = 'uk',
}: {
  children: React.ReactNode;
  locale?: string;
}) {
  const activeLocale = messagesByLocale[locale] ? locale : 'uk';
  const messages = messagesByLocale[activeLocale];

  return (
    <NextIntlClientProvider locale={activeLocale} messages={messages}>
      <div lang={activeLocale} style={{ display: 'contents' }}>
        {children}
      </div>
    </NextIntlClientProvider>
  );
}
