import React, { Suspense } from 'react';
import { lazyWithReload } from '../utils/lazyReload';

// The Markdown parser (~100 kB) is only fetched once an answer is on screen, keeping first load light.
const ReactMarkdown = lazyWithReload(() => import('react-markdown'));

/** Renders Markdown; shows the plain text until the parser has loaded (no layout jump for short text). */
export const LazyMarkdown: React.FC<{ children: string }> = React.memo(({ children }) => (
  <Suspense fallback={<div className="whitespace-pre-wrap">{children}</div>}>
    <ReactMarkdown>{children}</ReactMarkdown>
  </Suspense>
));

/** Starts downloading the parser early (e.g. when the user sends a prompt). */
export const preloadMarkdown = () => {
  ReactMarkdown.preload();
};
