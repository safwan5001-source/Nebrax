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
  /** الوحدات الجاهزة لها شاشة؛ غيرها رابط بشارة «قريباً» حتى تُبنى. */
  built?: boolean;
  appKey?: string;
  permission?: string;
  openInNewTab?: boolean;
}

interface NavGroup {
  title: string;
  icon: LucideIcon;
  items: NavItem[];
  appKey?: string;
  permission?: string;
}

const POS_NAV_ICONS: Record<(typeof POS_SIDEBAR_LAUNCH_ITEMS)[number]['key'], LucideIcon> = {
  posStart: Store,
  posSessions: Clock,
  posReport: Receipt,
  posAudit: ClipboardCheck,
  posSettings: SlidersHorizontal,
};

const GROUPS: NavGroup[] = [
  {
    title: 'sales',
    icon: Receipt,
    items: [
      { href: '/invoices', icon: FileText, key: 'invoicesManage', built: true },
      { href: '/delivery-notes', icon: ClipboardCheck, key: 'deliveryNotes', built: true, appKey: 'sales.invoicing', permission: 'delivery_notes.view' },
      { href: '/invoices/new', icon: FilePlus, key: 'invoiceCreate', built: true },
      { href: '/quotes', icon: ClipboardList, key: 'quotesManage', built: true },
      { href: '/quotes/new', icon: FilePlus2, key: 'quoteCreate', built: true },
      { href: '/credit-notes', icon: FileMinus, key: 'creditNotes', built: true },
      { href: '/returns', icon: Undo2, key: 'salesReturns', built: true },
      { href: '/recurring-invoices', icon: CalendarClock, key: 'recurringInvoices', built: true },
      { href: '/payments', icon: CreditCard, key: 'customerPayments', built: true },
      { href: '/customer-refunds', icon: Banknote, key: 'customerRefunds', built: true, permission: 'customer_refunds.view' },
      { href: '/sales-settings', icon: SlidersHorizontal, key: 'salesSettings', built: true },
    ],
  },
  {
    title: 'pos',
    icon: Store,
    appKey: 'sales.pos',
    items: POS_SIDEBAR_LAUNCH_ITEMS.map((item) => ({
      ...item,
      icon: POS_NAV_ICONS[item.key],
      built: true,
      ...(item.key === 'posAudit' ? { permission: 'pos.audit.view' } : {}),
    })),
  },
  {
    title: 'ecommerce',
    icon: ShoppingCart,
    items: [
      { href: '/commerce', icon: ShoppingCart, key: 'ecommerce', built: true },
    ],
  },
  {
    title: 'customers',
    icon: Users,
    items: [
      { href: '/partners', icon: Users, key: 'customersManage', built: true },
      { href: '/partners/new', icon: UserPlus, key: 'customerCreate', built: true },
      { href: '/appointments', icon: CalendarCheck, key: 'appointments', built: true },
      { href: '/contacts', icon: Contact, key: 'contactList', built: true },
      { href: '/crm', icon: Handshake, key: 'crm', built: true, appKey: 'crm.follow_up' },
      { href: '/customer-settings', icon: SlidersHorizontal, key: 'customerSettings', built: true },
    ],
  },
];
