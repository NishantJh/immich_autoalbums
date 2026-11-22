import { ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ThumbnailImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackClassName?: string;
  loading?: 'lazy' | 'eager';
}

export function ThumbnailImage({
  src,
  alt,
  className = 'h-full w-full object-cover',
  fallbackClassName = 'h-full w-full',
  loading = 'lazy',
}: ThumbnailImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200/80 dark:from-[#161A23] dark:to-[#10131A] text-zinc-400 dark:text-zinc-600 ${fallbackClassName}`}
      >
        <ImageOff className="h-4 w-4 opacity-70" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
