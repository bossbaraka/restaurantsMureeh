import React, { useCallback, useMemo, useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';

interface ProductImageProps {
  src?: string;
  alt: string;
  /** First cards above the fold skip lazy-loading and get network priority. */
  priority?: boolean;
  className?: string;
  sizes?: string;
  /** Target width in CSS pixels for CDN-based resizing. */
  width?: number;
}

type ImageState = 'loading' | 'ready' | 'error';

interface LoadState {
  src: string;
  state: ImageState;
}

/**
 * Compress and resize a remote image URL via well-known CDN query parameters.
 *
 * - Unsplash: `?w=…&q=…&auto=format&fit=crop`
 * - Cloudinary / similar: append `w_…,q_…,f_auto` via `?tr=…` when detected.
 *
 * Unknown hosts pass through untouched. This dramatically reduces payload size
 * for product cards on mobile connections without sacrificing visual quality.
 */
export function optimizeImageUrl(src: string, width = 480, quality = 70): string {
  if (!src) return src;
  try {
    const url = new URL(src);
    const host = url.hostname;

    // Unsplash
    if (/(^|\.)unsplash\.com$/.test(host)) {
      url.searchParams.set('auto', 'format');
      url.searchParams.set('fit', 'crop');
      url.searchParams.set('w', String(width));
      url.searchParams.set('q', String(quality));
      return url.toString();
    }

    // Google user content (Photos / Maps) – supports =wNNN
    if (/(^|\.)(googleusercontent|ggpht)\.com$/.test(host)) {
      // Strip any existing =sXX / =wXX and re-append at target width
      const base = src.replace(/=[ws]\d+(-[a-z]+)?/g, '');
      return `${base}=w${width}`;
    }

    // Cloudinary
    if (/(^|\.)cloudinary\.com$/.test(host)) {
      // Replace the existing /upload/<transforms>/ with optimized transforms.
      const parts = url.pathname.split('/upload/');
      if (parts.length === 2) {
        const transforms = `f_auto,q_${quality},w_${width},c_fill`;
        url.pathname = `${parts[0]}/upload/${transforms}/${parts[1]!.replace(/^[a-z]_[^/]+\/?/g, '')}`;
        return url.toString();
      }
    }

    return src;
  } catch {
    return src;
  }
}

/**
 * Menu image with a brand-tinted shimmer placeholder and a graceful fallback.
 * The box is reserved by the parent's aspect ratio, so the grid never jumps
 * while images decode. Load state is derived during render (keyed by `src`),
 * which keeps a src change in sync without an extra render pass, and the
 * skeleton is released the moment the bitmap lands — including when the image
 * was already in the browser cache before React attached its handler.
 *
 * Safari note: Safari sometimes fails to fire `load` when the image is served
 * from the memory cache, so we also guard against that case in attachRef using
 * `complete && naturalWidth > 0`. We also add a tiny setTimeout safety net so
 * cached/stale placeholders never linger on older iOS versions.
 */
export const ProductImage: React.FC<ProductImageProps> = ({
  src,
  alt,
  priority = false,
  className = '',
  sizes,
  width = 480,
}) => {
  const rawSrc = src || '';
  const currentSrc = useMemo(
    () => (rawSrc ? optimizeImageUrl(rawSrc, width, 70) : ''),
    [rawSrc, width]
  );
  const [loadState, setLoadState] = useState<LoadState>({
    src: currentSrc,
    state: currentSrc ? 'loading' : 'error',
  });

  const state: ImageState =
    loadState.src === currentSrc ? loadState.state : currentSrc ? 'loading' : 'error';

  const markReady = useCallback(() => {
    setLoadState({ src: currentSrc, state: 'ready' });
  }, [currentSrc]);

  const markError = useCallback(() => {
    setLoadState({ src: currentSrc, state: 'error' });
  }, [currentSrc]);

  // Runs on mount and whenever the node is swapped: catches cached images that
  // finished decoding before React could subscribe to their load event, and
  // handles Safari's occasional missing `load` event.
  const attachRef = useCallback(
    (node: HTMLImageElement | null) => {
      if (node && node.complete && node.naturalWidth > 0) {
        markReady();
        return;
      }
      // Safari safety net: poll once a tick for already-cached assets.
      if (node) {
        window.setTimeout(() => {
          if (node.complete && node.naturalWidth > 0) {
            markReady();
          }
        }, 0);
      }
    },
    [markReady]
  );

  return (
    <>
      {currentSrc ? (
        <img
          ref={attachRef}
          src={currentSrc}
          alt={alt}
          onLoad={markReady}
          onError={markError}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          // React 19 recognizes `fetchPriority`; React 18 passes it through as an
          // attribute (lowercase in DOM) — which is what browsers understand.
          {...({ fetchPriority: priority ? 'high' : 'auto' } as React.ImgHTMLAttributes<HTMLImageElement>)}
          sizes={sizes}
          className={`menu-img ${state === 'ready' ? 'is-ready' : ''} ${className}`}
          style={state === 'ready' ? undefined : { color: 'transparent' }}
        />
      ) : null}

      {state === 'loading' && <div className="menu-img__skeleton" aria-hidden="true" />}

      {state === 'error' && (
        <div className="menu-img__fallback" aria-hidden="true">
          <UtensilsCrossed className="w-6 h-6 stroke-1" />
        </div>
      )}
    </>
  );
};
