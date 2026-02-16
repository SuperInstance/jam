import React from 'react';
import { motion } from 'motion/react';

interface WaveformProps {
  isActive: boolean;
  audioLevel?: number;
}

const BAR_COUNT = 5;

export const Waveform: React.FC<WaveformProps> = ({ isActive, audioLevel = 0 }) => {
  if (!isActive) return null;

  // Scale audio level (0-1 range) to pixel heights
  const baseHeight = 4;
  const maxHeight = 24;
  const scaledLevel = Math.min(audioLevel * 500, 1); // normalize RMS to 0-1
  const levelHeight = baseHeight + scaledLevel * (maxHeight - baseHeight);

  return (
    <div className="flex items-center gap-0.5 h-6">
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        // Offset each bar slightly for a wave effect
        const barVariation = 0.6 + Math.sin(i * 1.2) * 0.4;
        const barHeight = Math.max(baseHeight, levelHeight * barVariation);

        return (
          <motion.div
            key={i}
            className="w-1 bg-red-400 rounded-full"
            animate={{ height: barHeight }}
            transition={{
              duration: 0.08,
              ease: 'easeOut',
            }}
          />
        );
      })}
    </div>
  );
};
