import React from 'react';
import { Providers } from './providers';

export default function RootNotFound() {
  return (
    <html lang="uk">
      <body>
        <Providers locale="uk">
          <div data-testid="custom-404">
            <h1>404</h1>
            <p>Сторінку не знайдено</p>
          </div>
        </Providers>
      </body>
    </html>
  );
}
