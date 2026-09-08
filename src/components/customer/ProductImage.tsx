import React, { useCallback, useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';

interface ProductImageProps {
  src?: string;
  alt: string;
  /** First cards above the fold skip lazy-loading and get network priority. */
  priority?: boolean;
  className?: string;
  sizes?: string;
}

type ImageState = 'loading' | 'ready' | 'error';

interface LoadState {
  src: string;
  state: ImageState;
}

/**
 * Menu image with a brand-tinted shimmer placeholder and a graceful fallback.
 * The box is reserved by the parent's aspect ratio, so the grid never jumps
 * while images decode. Load state is derived during render (keyed by `src`),
 * which keeps a src change in sync without an extra render pass, and the
 * skeleton is released the moment the bitmap lands — including when the image
 * was already in the browser cache before React attached its handler.
 */
export const ProductImage: React.FC<ProductImageProps> = ({
  src,
  alt,
  priority = false,
  className = '',
  sizes,
}) => {
  const currentSrc = src || '';
  const [loadState, setLoadState] = useState<LoadState>({
    src: currentSrc,
    state: currentSrc ? 'loading' : 'error',
  });

  const state: ImageState =
    loadState.src === currentSrc ? loadState.state : currentSrc ? 'loading' : 'error';

  const handleLoad = useCallback(() => {
    setLoadState({ src: currentSrc, state: 'ready' });
  }, [currentSrc]);

  const handleError = useCallback(() => {
    setLoadState({ src: currentSrc, state: 'error' });
  }, [currentSrc]);

  // Runs on mount and whenever the node is swapped: catches cached images that
  // finished decoding before React could subscribe to their load event.
  const attachRef = useCallback(
    (node: HTMLImageElement | null) => {
      if (node && node.complete && node.naturalWidth > 0) {
        setLoadState({ src: currentSrc, state: 'ready' });
      }
    },
    [currentSrc]
  );

  return (
    <>
      {currentSrc ? (
        <img
          ref={attachRef}
          src={currentSrc}
          alt={alt}
          onLoad={handleLoad}
          onError={handleError}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          sizes={sizes}
          className={`menu-img ${state === 'ready' ? 'is-ready' : ''} ${className}`}
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
