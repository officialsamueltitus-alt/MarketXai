import React, { Suspense } from 'react';
import { lazyWithReload } from '../utils/lazyReload';

// The Markdown parser (~100 kB) is only fetched once an answer is on screen, keeping first load light.
const ReactMarkdown = lazyWithReload(() => import('react-markdown'));

// Answers can quote the web: links only open as plain http(s) in a new tab without passing this page along, and images
// are never loaded from third-party hosts (a remote image would reveal the reader's IP address to that host)
const SAFE_HREF = /^(https?:\/\/|\/(?!\/)|#)/i;
const MD_COMPONENTS = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) =>
    href && SAFE_HREF.test(href) ? (
      <a href={href} target={href.startsWith('/') || href.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer nofollow ugc">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt }: { alt?: string }) => (alt ? <span>{alt}</span> : null),
};

/** Renders Markdown; shows the plain text until the parser has loaded (no layout jump for short text). */
export const LazyMarkdown: React.FC<{ children: string }> = React.memo(({ children }) => (
  <Suspense fallback={<div className="whitespace-pre-wrap">{children}</div>}>
    <ReactMarkdown components={MD_COMPONENTS as any}>{children}</ReactMarkdown>
  </Suspense>
));

/** Starts downloading the parser early (e.g. when the user sends a prompt). */
export const preloadMarkdown = () => {
  ReactMarkdown.preload();
};
