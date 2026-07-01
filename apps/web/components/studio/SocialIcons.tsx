"use client";

// Official brand SVG icons for social platforms (paths from Simple Icons)

interface IconProps {
  className?: string;
}

export function InstagramIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ig-grad" cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#fdf497" />
          <stop offset="5%" stopColor="#fdf497" />
          <stop offset="45%" stopColor="#fd5949" />
          <stop offset="60%" stopColor="#d6249f" />
          <stop offset="90%" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="5.5" fill="url(#ig-grad)" />
      <circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="1.7" fill="none" />
      <circle cx="17.5" cy="6.5" r="1.1" fill="white" />
    </svg>
  );
}

export function YoutubeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="5" width="22" height="14" rx="4" fill="#FF0000" />
      <polygon points="10,8.5 10,15.5 16,12" fill="white" />
    </svg>
  );
}

export function LinkedInIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="4" fill="#0A66C2" />
      <path
        d="M7 10h2.5v7H7v-7zm1.25-4a1.25 1.25 0 110 2.5A1.25 1.25 0 019.25 6zM11 10h2.4v.96h.03c.33-.63 1.15-1.29 2.37-1.29C18.2 9.67 19 11.1 19 13.4V17h-2.5v-3.15c0-.93-.02-2.13-1.3-2.13-1.3 0-1.5 1.01-1.5 2.06V17H11v-7z"
        fill="white"
      />
    </svg>
  );
}

export function FacebookIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="4" fill="#1877F2" />
      <path
        d="M16 8h-2c-.55 0-1 .45-1 1v2h3l-.5 3h-2.5V22h-3v-8H8v-3h2V9a4 4 0 014-4h2v3z"
        fill="white"
      />
    </svg>
  );
}

export function TikTokIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="4" fill="#000000" />
      <path
        d="M17 8.5a3.5 3.5 0 01-3.5-3.5h-2.25V15a1.75 1.75 0 11-1.75-1.75c.16 0 .32.02.47.06V11.03A4 4 0 1016 15V9.56c.92.6 2.02.94 3 .94V8.26A3.5 3.5 0 0117 8.5z"
        fill="white"
      />
      <path
        d="M16.5 8.5c.55.63 1.3 1.1 2.13 1.3V8.26c-.5-.12-.96-.38-1.38-.73A3.5 3.5 0 0117 8.5h-.5z"
        fill="#69C9D0"
      />
    </svg>
  );
}

export function PinterestIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="11" fill="#E60023" />
      <path
        d="M12 2C6.48 2 2 6.48 2 12c0 4.24 2.65 7.86 6.39 9.29-.09-.78-.17-1.99.03-2.84.19-.78 1.27-5.37 1.27-5.37s-.32-.65-.32-1.6c0-1.5.87-2.63 1.95-2.63.92 0 1.37.69 1.37 1.52 0 .93-.59 2.32-.9 3.6-.25 1.07.54 1.95 1.59 1.95 1.91 0 3.19-2.44 3.19-5.33 0-2.2-1.48-3.74-4.04-3.74-2.96 0-4.79 2.21-4.79 4.68 0 .85.25 1.45.62 1.91.17.2.19.28.13.51-.04.17-.15.57-.19.73-.06.24-.25.33-.45.24-1.26-.52-1.85-1.91-1.85-3.47 0-2.58 2.17-5.67 6.46-5.67 3.49 0 5.8 2.53 5.8 5.25 0 3.59-1.98 6.27-4.9 6.27-1.04 0-2.01-.56-2.34-1.21l-.67 2.58c-.22.84-.67 1.68-1.06 2.34.8.24 1.64.37 2.51.37 5.52 0 10-4.48 10-10S17.52 2 12 2z"
        fill="white"
      />
    </svg>
  );
}
