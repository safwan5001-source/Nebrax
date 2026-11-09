import React from 'react';
import { Composition } from 'remotion';
import './lib/fonts';
import { AwjCommercial } from './AwjCommercial';
import { DURATION, FPS, HEIGHT, WIDTH } from './config/timeline';

export const RemotionRoot: React.FC = () => (
  <Composition id="AwjCommercial" component={AwjCommercial} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
);
