'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Banknote,
  BarChart3,
  BookOpen,
  BookText,
  Boxes,
  Building,
  Building2,
  CalendarCheck,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Compass,
  Contact,
  CreditCard,
  Factory,
  FileMinus,
  FilePlus,
  FilePlus2,
  FileQuestion,
  FileSignature,
  FileText,
  Fingerprint,
  Fuel,
  HandCoins,
  Handshake,
  Hash,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  Lock,
  MapPin,
  MapPinPlus,
  Network,
  Package,
  PackagePlus,
  Receipt,
  ReceiptText,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Terminal,
  Timer,
  Truck,
  type LucideIcon,
  Undo2,
  UserCog,
  UserPlus,
  Users,
  WalletCards,
  Warehouse,
  Webhook,
  Workflow,
  Wrench,
  X,
} from 'lucide-react';
import { CompanyLogoMark } from '@/components/layout/company-logo-mark';
import { useCompany } from '@/lib/company';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { hiddenApplicationKeys, isNavEntryVisible } from '@/components/layout/nav-visibility';
import { POS_SIDEBAR_LAUNCH_ITEMS, posNavNewTabAnchorProps } from '@/lib/pos-workspace';

interface NavItem {
  href: string;
  icon: LucideIcon;
  key: string;
  built?: boolean;
  appKey?: string;
  permission?: string;
  openInNewTab?: boolean;
}
