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
- Responsive desktop, tablet, and mobile UX.
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

External products such as Microsoft Dynamics 365 may be studied for enterprise UX and pattern discipline, but AWJ must not become a visual clone of another product.

References are inputs to expert judgment, not templates to copy.

The intended outcome is recognizably **AWJ**.

## 6. Review gate

No AWJ V2 pattern or representative screen should be considered design-approved solely from a generated mockup or a single attractive screenshot.

Before approval, it should be reviewed for:

1. Business and accounting workflow correctness.
2. Information hierarchy and density.
3. Consistency with approved AWJ V2 patterns and design foundations.
4. Arabic RTL quality and English mirroring implications.
5. Desktop, tablet/iPad, and mobile behavior as applicable.
6. Keyboard/touch efficiency for the workflow.
7. Accessibility and complete interaction states.
8. Absence of generic/template/AI-generated visual patterns.
9. Feasibility and maintainability through shared tokens and components.
10. Visual craft at a level appropriate for a premium global ERP product.

## 7. Relationship to the Blueprint

This document supplements:

`docs/plans/design/AWJ_DESIGN_SYSTEM_V2_BLUEPRINT.md`

The Blueprint defines the current V2 direction and pattern architecture. This document defines the **mandatory quality bar** for evaluating those patterns and their implementation.

If a future design is technically consistent with the Blueprint but feels generic, templated, mechanically generated, or below this quality standard, it is **not sufficient for AWJ V2 approval**.

---

**Core rule:** AWJ V2 must feel deliberately designed and meticulously implemented as a mature, premium, global ERP product — never as a generic AI-generated interface.
