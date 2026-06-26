"use client";

import { useEffect, useState } from "react";

interface ScoreGaugeProps {
  score: number;
  label: string;
  size?: number;
}

function scoreColor(score: number): { stroke: string; text: string } {
  if (score >= 80) return { stroke: "#10b981", text: "text-emerald-500" };
  if (score >= 60) return { stroke: "#f59e0b", text: "text-amber-500" };
  return { stroke: "#ef4444", text: "text-red-500" };
}

export function ScoreGauge({ score, label, size = 120 }: ScoreGaugeProps) {
  const [displayScore, setDisplayScore] = useState(0);

  useEffect(() => {
    // Animate from 0 to score on mount
    const timeout = setTimeout(() => setDisplayScore(score), 50);
    return () => clearTimeout(timeout);
  }, [score]);

  const strokeWidth = size * 0.08;
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  // Use 270° arc (3/4 of circle), starting at 135° (bottom-left)
  const arcFraction = 0.75;
  const arcLength = circumference * arcFraction;
  const gap = circumference - arcLength;

  const progress = (displayScore / 100) * arcLength;
  const offset = arcLength - progress;

  const { stroke, text } = scoreColor(score);

  // Rotation: start the arc at 135deg (bottom-left, going clockwise)
  const rotation = 135;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Background track */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${gap}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform={`rotate(${rotation} ${cx} ${cy})`}
          />
          {/* Progress arc */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${gap}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(${rotation} ${cx} ${cy})`}
            style={{
              transition: "stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-bold leading-none ${text}`} style={{ fontSize: size * 0.22 }}>
            {Math.round(displayScore)}
          </span>
          <span
            className="text-muted-foreground leading-none mt-0.5"
            style={{ fontSize: size * 0.10 }}
          >
            /100
          </span>
        </div>
      </div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </div>
  );
}
