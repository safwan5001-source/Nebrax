"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  clonePresentationConfig,
  DEFAULT_PRESENTATION_CONFIG,
  type HomeBuilderSectionKey,
  normalizePresentationConfig,
  presentationConfigsEqual,
  type StorefrontPresentationConfig,
} from "./presentation";