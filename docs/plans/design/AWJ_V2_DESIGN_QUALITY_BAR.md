# AWJ Design System V2 — Design Quality Bar

**Status:** MANDATORY DESIGN PRINCIPLE
**Date:** 2026-09-08
**Applies to:** AWJ Design System V2, all V2 patterns, prototypes, implementation reviews, and future UI work.

## 1. Ambition

AWJ V2 must target a **professional, distinctive, world-class enterprise product experience**.

The goal is not merely to make the interface modern or visually attractive. The finished product should feel deliberately designed and engineered by an expert multidisciplinary team with deep competence in:

- Enterprise ERP product design.
- Accounting and financial software UX.
- Arabic / RTL interface design.
- Interaction design.
- Information architecture.
- Data-dense application design.
- Responsive desktop, laptop, tablet, and mobile UX.
- Accessibility.
- Front-end engineering and design-system implementation.

AWJ should feel authored, coherent, intentional, mature, and production-grade.

## 2. No “AI-generated UI” appearance

AWJ V2 must **not look AI-generated, template-generated, or assembled from generic SaaS patterns**.

Avoid common signs of generic/generated UI, including:

- Repetitive card grids without a workflow reason.
- Oversized cards and controls.
- Excessive whitespace that reduces ERP productivity.
- Decorative gradients, glow, glass effects, and unnecessary shadows.
- Arbitrary icon containers or colorful icon boxes.
- Excessive pills/badges.
- Repeating identical section compositions regardless of business meaning.
- Generic dashboard-first layouts imposed on transactional workflows.
- Random visual novelty without functional value.
- Inconsistent spacing, radii, typography, control sizes, or action hierarchy.
- Decorative micro-interactions that slow daily work.
- Components invented per screen instead of following the shared system.
- Visually plausible but operationally unrealistic ERP workflows.

AI may assist the design and implementation process, but its output is never accepted merely because it looks polished. Every result must be reviewed against AWJ product logic, accounting workflows, the approved patterns, accessibility, responsive behavior, and this quality bar.

## 3. What “world-class” means for AWJ

World-class does **not** mean visually loud or experimental for its own sake.

For AWJ it means:

- Immediate clarity despite dense business information.
- Fast, low-friction daily workflows.
- Strong hierarchy without excessive decoration.
- Excellent Arabic RTL composition rather than an LTR design mechanically mirrored.
- Precise financial presentation.
- Predictable actions and states.
- Thoughtful keyboard, pointer, touch, and responsive behavior.
- Strong empty, loading, error, validation, disabled, read-only, permission, and edge states.
- Consistency across modules without forcing unrelated workflows into identical layouts.
- Subtle craftsmanship in typography, spacing, alignment, borders, interaction states, and data presentation.
- A distinctive AWJ identity that remains professional and trustworthy.
- Implementation quality that preserves the intended design rather than approximating it screen by screen.

## 4. Creativity rule

AWJ should be creative through **problem solving, hierarchy, workflow design, interaction quality, and thoughtful use of space** — not through decoration.

Innovation is encouraged when it measurably improves comprehension, speed, confidence, or usability. Novelty that weakens accounting clarity, ERP density, consistency, accessibility, or user trust should be rejected.

## 5. Reference policy

External enterprise products and design systems may be studied for enterprise UX and pattern discipline, including Microsoft Dynamics 365 Finance & Operations, SAP Fiori, Oracle Redwood, and other high-quality ERP/business applications. AWJ must not become a visual clone of any one product.

References are inputs to expert judgment, not templates to copy.

The intended outcome is recognizably **AWJ**.

## 6. Full responsive and viewport coverage — mandatory

AWJ V2 is not a desktop design with a mobile fallback. Every approved pattern must be deliberately designed and validated across the full practical range of supported viewport sizes and input modes.

Required coverage includes:

- Large desktop / wide monitors.
- Standard desktop monitors.
- Laptop displays, including constrained-height laptop viewports.
- Tablet / iPad in landscape.
- Tablet / iPad in portrait.
- Large phones.
- Standard phones.
- Narrow/small phones.
- Intermediate widths and heights between named device categories.
- Portrait and landscape where the workflow is realistically used in both.
- Browser zoom and text scaling scenarios required for accessibility.

Do not design only for a few named device screenshots. Responsive behavior must be **content- and pattern-driven**, with deliberate breakpoints or container behavior where the interface actually needs to recompose.

The system must handle both width and height constraints. A layout that works at a wide desktop resolution but breaks on a laptop because of reduced vertical space is not considered responsive.

Each pattern specification must define what happens to, as applicable:

- Primary navigation and App Shell.
- Page Header and contextual actions.
- Forms and field groups.
- Tabs, sections, accordions, drawers, dialogs, and side panels.
- Data grids, document line items, sticky regions, and horizontal overflow.
- Filters, search, bulk actions, and pagination.
- Totals and financial summaries.
- Touch targets and pointer/keyboard interactions.
- Long Arabic labels, large monetary values, validation messages, and localization expansion.
- Loading, empty, error, permission, disabled, read-only, and unsaved-change states.

Responsive adaptation must preserve the business relationships in the data. Do not automatically convert every table into cards, hide important financial columns, or remove actions merely to make a narrow screenshot look clean.

Desktop/laptop should prioritize high-productivity, data-dense workflows; tablet should remain a serious working surface; mobile should deliberately recompose workflows for touch and narrow space rather than mechanically shrink the desktop layout.

## 7. Review gate

No AWJ V2 pattern or representative screen should be considered design-approved solely from a generated mockup or a single attractive screenshot.

Before approval, it should be reviewed for:

1. Business and accounting workflow correctness.
2. Information hierarchy and density.
3. Consistency with approved AWJ V2 patterns and design foundations.
4. Arabic RTL quality and English mirroring implications.
5. Full responsive/viewport coverage: desktop, laptop, tablet/iPad, mobile, and meaningful intermediate sizes.
6. Width and height constraints, orientation, zoom/text scaling, and localization stress cases where applicable.
7. Keyboard, pointer, and touch efficiency for the workflow.
8. Accessibility and complete interaction states.
9. Absence of generic/template/AI-generated visual patterns.
10. Feasibility and maintainability through shared tokens and components.
11. Visual craft at a level appropriate for a premium global ERP product.

A design that looks correct only at its mockup size fails this review gate.

## 8. Relationship to the Blueprint

This document supplements:

`docs/plans/design/AWJ_DESIGN_SYSTEM_V2_BLUEPRINT.md`

The Blueprint defines the current V2 direction and pattern architecture. This document defines the **mandatory quality bar** for evaluating those patterns and their implementation.

If a future design is technically consistent with the Blueprint but feels generic, templated, mechanically generated, fails at realistic viewport sizes, or falls below this quality standard, it is **not sufficient for AWJ V2 approval**.

---

**Core rule:** AWJ V2 must feel deliberately designed and meticulously implemented as a mature, premium, global ERP product across the full range of real working screens — never as a generic AI-generated interface or a desktop-only design with responsive patches.
