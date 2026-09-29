import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { dark } from './config/theme';
import { S1Hook } from './scenes/S1Hook';
import { S2Sale } from './scenes/S2Sale';
import { S3Ledger } from './scenes/S3Ledger';
import { S4Control } from './scenes/S4Control';
import { S5Brand } from './scenes/S5Brand';

/**
 * One continuous film, not a slideshow: every act reads the same master frame and
 * decides for itself when it exists, so hand-offs can overlap by a few frames.
 * Layer order is back → front.
 */
export const AwjCommercial: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: dark.bg, overflow: 'hidden' }}>
      <S1Hook f={f} />
      <S2Sale f={f} />
      <S3Ledger f={f} />
      <S5Brand f={f} />
      <S4Control f={f} />
    </AbsoluteFill>
  );
};
