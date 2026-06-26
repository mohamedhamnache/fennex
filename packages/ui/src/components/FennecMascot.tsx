import React from "react";

interface FennecMascotProps {
  size?: number;
  className?: string;
  message?: string;
}

export function FennecMascot({ size = 80, className = "", message }: FennecMascotProps) {
  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      {/* Simplified fennec fox SVG mascot */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 80 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Body */}
        <ellipse cx="40" cy="52" rx="20" ry="16" fill="#F5A623" />
        {/* Head */}
        <circle cx="40" cy="34" r="16" fill="#F5A623" />
        {/* Left ear */}
        <polygon points="18,24 8,4 28,18" fill="#F5A623" />
        <polygon points="18,22 12,8 26,18" fill="#FFDBA4" />
        {/* Right ear */}
        <polygon points="62,24 72,4 52,18" fill="#F5A623" />
        <polygon points="62,22 68,8 54,18" fill="#FFDBA4" />
        {/* Face */}
        <ellipse cx="40" cy="36" rx="10" ry="8" fill="#FFDBA4" />
        {/* Eyes */}
        <circle cx="34" cy="32" r="3" fill="#2D1B00" />
        <circle cx="46" cy="32" r="3" fill="#2D1B00" />
        <circle cx="35" cy="31" r="1" fill="white" />
        <circle cx="47" cy="31" r="1" fill="white" />
        {/* Nose */}
        <ellipse cx="40" cy="37" rx="2" ry="1.5" fill="#C0392B" />
        {/* Tail */}
        <path
          d="M58 58 Q72 52 70 44 Q68 38 62 42"
          stroke="#F5A623"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M65 43 Q72 40 70 44"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      {message && <p className="text-center text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
