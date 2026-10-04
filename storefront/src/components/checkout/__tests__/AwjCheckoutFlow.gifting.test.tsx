import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontDeliverySchedule } from "@/lib/commerce/checkout-gifting";
import type { StorefrontCheckout } from "@/lib/commerce/checkout-types";
import { AwjCheckoutFlow } from "../AwjCheckoutFlow";

/**
 * FLOWERS-H12b — the optional schedule and gift stages (ADR-19 / ADR-15) of the
 * AWJ checkout. A store without either keeps the original six stages (proved by
 * `AwjCheckoutFlow.test.tsx`); here the stages exist only when offered, save to
 * their own endpoints, never block the shopper into a dead end, and are
 * revisited when completion refuses them.
 */

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => {
    const fn = (key: string, vars?: Record<string, unknown>) =>
      vars
        ? `${namespace}.${key}:${JSON.stringify(vars)}`
        : `${namespace}.${key}`;
    fn.has = () => true;
    return fn;
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/sa/en/checkout" }));

const actions = vi.hoisted(() => ({
  startOrResumeAwjCheckout: vi.fn(),
  updateAwjContact: vi.fn(),
  updateAwjAddress: vi.fn(),
  updateAwjDelivery: vi.fn(),
  getAwjPaymentMethods: vi.fn(),
  updateAwjPayment: vi.fn(),
  completeAwjCheckoutAction: vi.fn(),
  getAwjCheckoutIdentity: vi.fn(),
  getAwjDeliverySchedule: vi.fn(),
  updateAwjSchedule: vi.fn(),
  updateAwjGift: vi.fn(),
}));
vi.mock("@/lib/data/awj-checkout", () => actions);

const SLOT_A = "0a1b2c3d-1111-4222-8333-444455556666";
const SLOT_B = "1a1b2c3d-1111-4222-8333-444455556666";

const money = (amount_minor: number) => ({ amount_minor, currency: "SAR" });

function cart() {
  return {
    kind: "awj" as const,
    items: [
      {
        id: "line-1",
        productId: "prod-1",
        variantId: null,
        variantDescriptor: null,
        name: "Bouquet",
        unitKey: "base",
        unitName: "piece",
        quantity: 1,
        unitPrice: money(12000),
        lineTotal: money(12000),
        available: true,
        personalization: [],
        addonOf: null,
        perParentQuantity: null,
      },
    ],
    subtotal: money(12000),
    currency: "SAR",
    hasUnavailableItems: false,
    itemCount: 1,
  };
}

function checkout(over: Partial<StorefrontCheckout> = {}): StorefrontCheckout {
  return {
    status: "active",
    contact: { name: null, phone: null, email: null },
    delivery: {
      method: null,
      amount: money(0),
      address: {
        country: null,
        region: null,
        city: null,
        district: null,
        street: null,
        postal_code: null,
        notes: null,
      },
    },
    payment: {
      payment_method_id: null,
      payment_method_name: null,
      method: null,
    },
    gift: null,
    giftOptions: {
      enabled: false,
      messageMaxLength: 250,
      allowHideSender: true,
      recipientPhoneRequired: true,
    },
    schedule: null,
    cart: cart(),
    ...over,
  };
}

function schedule(
  over: Partial<StorefrontDeliverySchedule> = {},
): StorefrontDeliverySchedule {
  return {
    enabled: true,
    required: true,
    method: "delivery",
    timezone: "Asia/Riyadh",
    dates: [
      {
        date: "2099-10-05",
        slots: [
          {
            id: SLOT_A,
            label: "Morning",
            labelEn: "Morning",
            startTime: "09:00",
            endTime: "12:00",
          },
          {
            id: SLOT_B,
            label: "Evening",
            labelEn: "Evening",
            startTime: "17:00",
            endTime: "21:00",
          },
        ],
      },
      {
        date: "2099-10-06",
        slots: [
          {
            id: SLOT_A,
            label: "Morning",
            labelEn: "Morning",
            startTime: "09:00",
            endTime: "12:00",
          },
        ],
      },
    ],
    ...over,
  };
}

type User = ReturnType<typeof userEvent.setup>;

/** contact → address → delivery (standard) and continue; lands on whatever follows delivery. */
async function throughDelivery(user: User) {
  await screen.findByLabelText("awjCheckout.contact.name");
  await user.type(screen.getByLabelText("awjCheckout.contact.name"), "Salem");
  await user.type(
    screen.getByLabelText("awjCheckout.contact.phone"),
    "0501234567",
  );
  await user.click(
    screen.getByRole("button", { name: "awjCheckout.continueToAddress" }),
  );
  await screen.findByLabelText("awjCheckout.address.country");
  await user.type(screen.getByLabelText("awjCheckout.address.country"), "SA");
  await user.type(screen.getByLabelText("awjCheckout.address.city"), "Dammam");
  await user.type(
    screen.getByLabelText("awjCheckout.address.street"),
    "King Fahd Rd",
  );
  await user.click(
    screen.getByRole("button", { name: "awjCheckout.continueToDelivery" }),
  );
  await screen.findByText("awjCheckout.delivery.heading");
  await user.click(
    screen.getByLabelText(/awjCheckout\.delivery\.methods\.standard/),
  );
}

function arrange(opts: {
  probe?: StorefrontDeliverySchedule | null;
  initial?: StorefrontCheckout;
  options?: StorefrontCheckout["giftOptions"];
}) {
  const initial =
    opts.initial ?? checkout(opts.options ? { giftOptions: opts.options } : {});
  actions.startOrResumeAwjCheckout.mockResolvedValue({
    success: true,
    checkout: initial,
  });
  actions.updateAwjContact.mockImplementation(async () => ({
    success: true,
    checkout: initial,
  }));
  actions.updateAwjAddress.mockImplementation(async () => ({
    success: true,
    checkout: initial,
  }));
  actions.updateAwjDelivery.mockImplementation(async () => ({
    success: true,
    checkout: {
      ...initial,
      delivery: { ...initial.delivery, method: "standard" },
    },
  }));
  actions.getAwjDeliverySchedule.mockImplementation(
    async () => opts.probe ?? null,
  );
  return initial;
}

const GIFT_ON = {
  enabled: true,
  messageMaxLength: 40,
  allowHideSender: true,
  recipientPhoneRequired: true,
};

describe("AwjCheckoutFlow — schedule and gift stages (FLOWERS-H12b)", () => {
  beforeEach(() => {
    for (const mock of Object.values(actions)) mock.mockReset();
    actions.getAwjCheckoutIdentity.mockResolvedValue("identity-g");
    actions.getAwjPaymentMethods.mockResolvedValue([]);
    localStorage.clear();
  });

  it("a store with neither policy keeps the original six steps", async () => {
    arrange({ probe: null });
    render(<AwjCheckoutFlow />);
    await screen.findByLabelText("awjCheckout.contact.name");
    expect(
      screen.getByText(/awjCheckout\.stepCounter:.*"total":6/),
    ).toBeInTheDocument();
  });

  it("adds the schedule step only when the channel offers scheduling", async () => {
    arrange({ probe: schedule() });
    render(<AwjCheckoutFlow />);
    await screen.findByLabelText("awjCheckout.contact.name");
    expect(
      screen.getByText(/awjCheckout\.stepCounter:.*"total":7/),
    ).toBeInTheDocument();
  });

  it("asks for a date and window, blocks Continue until both are chosen when required, then saves them to their own endpoint", async () => {
    const initial = arrange({ probe: schedule() });
    actions.getAwjDeliverySchedule.mockImplementation(async (method: string) =>
      schedule({ method: method as "delivery" }),
    );
    actions.updateAwjSchedule.mockImplementation(async () => ({
      success: true,
      checkout: {
        ...initial,
        delivery: { ...initial.delivery, method: "standard" },
        schedule: {
          date: "2099-10-05",
          valid: true,
          slot: {
            id: SLOT_B,
            label: "Evening",
            labelEn: "Evening",
            startTime: "17:00",
            endTime: "21:00",
          },
        },
      },
    }));
    const user = userEvent.setup();
    render(<AwjCheckoutFlow />);
    await throughDelivery(user);
    await user.click(
      screen.getByRole("button", { name: "awjCheckout.continueToSchedule" }),
    );

    const next = await screen.findByRole("button", {
      name: "awjCheckout.continueToPayment",
    });
    expect(next).toBeDisabled();
    expect(
      screen.getByText("awjCheckout.schedule.requiredNote"),
    ).toBeInTheDocument();

    await user.click(
      document.querySelector(
        '[data-schedule-date="2099-10-05"]',
      ) as HTMLElement,
    );
    expect(next).toBeDisabled(); // a date alone is not enough
    await user.click(
      document.querySelector(`[data-schedule-slot="${SLOT_B}"]`) as HTMLElement,
    );
    expect(next).toBeEnabled();
    await user.click(next);

    await waitFor(() =>
      expect(actions.updateAwjSchedule).toHaveBeenCalledWith({
        date: "2099-10-05",
        slot_id: SLOT_B,
      }),
    );
    expect(actions.updateAwjSchedule).toHaveBeenCalledTimes(1);
    await screen.findByText("awjCheckout.payment.noMethodsEnabled");
  });

  it("an optional schedule never blocks, and saves nothing when left unchosen", async () => {
    arrange({ probe: schedule({ required: false }) });
    actions.getAwjDeliverySchedule.mockImplementation(async () =>
      schedule({ required: false }),
    );
    const user = userEvent.setup();
    render(<AwjCheckoutFlow />);
    await throughDelivery(user);
    await user.click(
      screen.getByRole("button", { name: "awjCheckout.continueToSchedule" }),
    );
    const next = await screen.findByRole("button", {
      name: "awjCheckout.continueToPayment",
    });
    expect(next).toBeEnabled();
    await user.click(next);
    await screen.findByText("awjCheckout.payment.noMethodsEnabled");
    expect(actions.updateAwjSchedule).not.toHaveBeenCalled();
  });

  it("a failed read of the windows offers a retry and does not trap the shopper", async () => {
    arrange({ probe: schedule() });
    actions.getAwjDeliverySchedule
      .mockResolvedValueOnce(schedule()) // up-front probe
      .mockResolvedValueOnce(null) // stage read fails
      .mockResolvedValue(schedule());
    const user = userEvent.setup();
    render(<AwjCheckoutFlow />);
    await throughDelivery(user);
    await user.click(
      screen.getByRole("button", { name: "awjCheckout.continueToSchedule" }),
    );
    await screen.findByText("awjCheckout.schedule.loadFailed");
    expect(
      screen.getByRole("button", { name: "awjCheckout.continueToPayment" }),
    ).toBeEnabled();
    await user.click(
      screen.getByRole("button", { name: "awjCheckout.schedule.retry" }),
    );
    await waitFor(() =>
      expect(
        document.querySelector('[data-schedule-date="2099-10-05"]'),
      ).not.toBeNull(),
    );
  });

  it("a required schedule with no selectable window is a clear dead-end message, not a silent block", async () => {
    arrange({ probe: schedule() });
    actions.getAwjDeliverySchedule.mockImplementation(async () =>
      schedule({ dates: [] }),
    );
    const user = userEvent.setup();
    render(<AwjCheckoutFlow />);
    await throughDelivery(user);
    await user.click(
      screen.getByRole("button", { name: "awjCheckout.continueToSchedule" }),
    );
    expect(
      await screen.findByText("awjCheckout.schedule.noWindows"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "awjCheckout.continueToPayment" }),
    ).toBeDisabled();
  });

  it("adds the gift step when the channel's gift policy is on, and gates Continue on the policy's required fields", async () => {
    const initial = arrange({ probe: null, options: GIFT_ON });
    actions.updateAwjGift.mockImplementation(async () => ({
      success: true,
      checkout: {
        ...initial,
        gift: {
          recipientName: "Mona",
          recipientPhone: "0555",
          senderDisplayName: "Salem",
          hideSender: false,
          message: "Happy birthday",
        },
      },
    }));
    const user = userEvent.setup();
    render(<AwjCheckoutFlow />);
    expect(
      await screen.findByText(/awjCheckout\.stepCounter:.*"total":7/),
    ).toBeInTheDocument();
    await throughDelivery(user);
    await user.click(
      screen.getByRole("button", { name: "awjCheckout.continueToGift" }),
    );

    const next = await screen.findByRole("button", {
      name: "awjCheckout.continueToPayment",
    });
    expect(next).toBeEnabled(); // not a gift → nothing required
    await user.click(screen.getByLabelText("awjCheckout.gift.isGift"));
    expect(next).toBeDisabled();
    // The card's "from" defaults to the purchaser, editable.
    expect(screen.getByLabelText("awjCheckout.gift.senderName")).toHaveValue(
      "Salem",
    );

    await user.type(
      screen.getByLabelText("awjCheckout.gift.recipientName"),
      "Mona",
    );
    expect(next).toBeDisabled(); // phone is required by this store's policy
    await user.type(
      screen.getByLabelText("awjCheckout.gift.recipientPhone"),
      "0555",
    );
    const message = screen.getByLabelText(
      "awjCheckout.gift.message",
    ) as HTMLTextAreaElement;
    await user.type(message, "x".repeat(60));
    expect(message.value).toHaveLength(40); // the store's own limit
    await user.clear(message);
    await user.type(message, "Happy birthday");
    expect(next).toBeEnabled();
    await user.click(next);

    await waitFor(() =>
      expect(actions.updateAwjGift).toHaveBeenCalledWith({
        is_gift: true,
        recipient_name: "Mona",
        recipient_phone: "0555",
        sender_name: "Salem",
        hide_sender: false,
        message: "Happy birthday",
      }),
    );
  });

  it("does not require the recipient's phone when the policy does not", async () => {
    arrange({
      probe: null,
      options: { ...GIFT_ON, recipientPhoneRequired: false },
    });
    const user = userEvent.setup();
    render(<AwjCheckoutFlow />);
    await throughDelivery(user);
    await user.click(
      screen.getByRole("button", { name: "awjCheckout.continueToGift" }),
    );
    await user.click(await screen.findByLabelText("awjCheckout.gift.isGift"));
    await user.type(
      screen.getByLabelText("awjCheckout.gift.recipientName"),
      "Mona",
    );
    expect(
      screen.getByRole("button", { name: "awjCheckout.continueToPayment" }),
    ).toBeEnabled();
  });

  it("hides the 'send anonymously' option when the store does not allow it", async () => {
    arrange({ probe: null, options: { ...GIFT_ON, allowHideSender: false } });
    const user = userEvent.setup();
    render(<AwjCheckoutFlow />);
    await throughDelivery(user);
    await user.click(
      screen.getByRole("button", { name: "awjCheckout.continueToGift" }),
    );
    await user.click(await screen.findByLabelText("awjCheckout.gift.isGift"));
    expect(screen.queryByLabelText("awjCheckout.gift.hideSender")).toBeNull();
  });

  it("turning an already-saved gift off clears it on the server; leaving an unsaved gift off sends nothing", async () => {
    const saved = checkout({
      giftOptions: GIFT_ON,
      gift: {
        recipientName: "Mona",
        recipientPhone: "0555",
        senderDisplayName: null,
        hideSender: false,
        message: null,
      },
    });
    arrange({ probe: null, initial: saved });
    actions.updateAwjGift.mockImplementation(async () => ({
      success: true,
      checkout: { ...saved, gift: null },
    }));
    const user = userEvent.setup();
    render(<AwjCheckoutFlow />);
    await throughDelivery(user);
    await user.click(
      screen.getByRole("button", { name: "awjCheckout.continueToGift" }),
    );
    const toggle = await screen.findByLabelText("awjCheckout.gift.isGift");
    expect(toggle).toBeChecked(); // resumed from the server's stored gift
    await user.click(toggle);
    await user.click(
      screen.getByRole("button", { name: "awjCheckout.continueToPayment" }),
    );
    await waitFor(() =>
      expect(actions.updateAwjGift).toHaveBeenCalledWith({ is_gift: false }),
    );
  });

  describe("completion refusals route the shopper back to the right stage", () => {
    async function toReview(user: User) {
      await user.click(
        await screen.findByRole("button", {
          name: "awjCheckout.continueToReview",
        }),
      );
      await screen.findByText("awjCheckout.review.heading");
    }

    it("schedule_unavailable returns to the schedule stage even when the up-front read missed it", async () => {
      const initial = arrange({ probe: null });
      const refreshed = {
        ...initial,
        delivery: { ...initial.delivery, method: "standard" },
        schedule: { date: "2099-10-05", valid: false, slot: null },
      };
      actions.completeAwjCheckoutAction.mockResolvedValue({
        success: false,
        kind: "review_required",
        items: [{ item_id: "", reason: "schedule_unavailable" }],
        checkout: refreshed,
        message: "x",
      });
      actions.getAwjDeliverySchedule
        .mockResolvedValueOnce(null) // the up-front read misses scheduling
        .mockResolvedValue(schedule());
      const user = userEvent.setup();
      render(<AwjCheckoutFlow />);
      await throughDelivery(user);
      await user.click(
        screen.getByRole("button", { name: "awjCheckout.continueToPayment" }),
      );
      await toReview(user);
      await user.click(
        screen.getByRole("button", { name: "awjCheckout.completeOrder" }),
      );

      await screen.findByText("awjCheckout.schedule.heading");
      // The refusal is authoritative: the stage joins the step list (7 steps,
      // not a 6-step bar with a screen that is not on it).
      expect(
        screen.getByText(/awjCheckout\.stepCounter:.*"total":7/),
      ).toBeInTheDocument();
      expect(
        screen.getByText("awjCheckout.schedule.invalidSelection"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("awjCheckout.reviewRequired.title"),
      ).toBeInTheDocument();
    });

    it("gift_incomplete returns to the gift stage", async () => {
      const initial = arrange({ probe: null, options: GIFT_ON });
      actions.completeAwjCheckoutAction.mockResolvedValue({
        success: false,
        kind: "review_required",
        items: [{ item_id: "", reason: "gift_incomplete" }],
        checkout: {
          ...initial,
          delivery: { ...initial.delivery, method: "standard" },
        },
        message: "x",
      });
      const user = userEvent.setup();
      render(<AwjCheckoutFlow />);
      await throughDelivery(user);
      await user.click(
        screen.getByRole("button", { name: "awjCheckout.continueToGift" }),
      );
      await user.click(
        await screen.findByRole("button", {
          name: "awjCheckout.continueToPayment",
        }),
      );
      await toReview(user);
      await user.click(
        screen.getByRole("button", { name: "awjCheckout.completeOrder" }),
      );
      await screen.findByText("awjCheckout.gift.heading");
      expect(
        screen.getByText(/awjCheckout\.stepCounter:.*"total":7/),
      ).toBeInTheDocument();
    });
  });

  it("the review shows the saved date and gift, and each row has its own edit control", async () => {
    const initial = checkout({ giftOptions: GIFT_ON });
    const saved = {
      ...initial,
      delivery: { ...initial.delivery, method: "standard" },
      schedule: {
        date: "2099-10-05",
        valid: true,
        slot: {
          id: SLOT_A,
          label: "Morning",
          labelEn: "Morning",
          startTime: "09:00",
          endTime: "12:00",
        },
      },
      gift: {
        recipientName: "Mona",
        recipientPhone: "0555",
        senderDisplayName: null,
        hideSender: true,
        message: "Happy birthday",
      },
    };
    arrange({ probe: schedule(), initial: saved });
    actions.getAwjDeliverySchedule.mockResolvedValue(schedule());
    actions.updateAwjGift.mockResolvedValue({ success: true, checkout: saved });
    const user = userEvent.setup();
    render(<AwjCheckoutFlow />);
    await throughDelivery(user);
    await user.click(
      screen.getByRole("button", { name: "awjCheckout.continueToSchedule" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "awjCheckout.continueToGift" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "awjCheckout.continueToPayment",
      }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "awjCheckout.continueToReview",
      }),
    );
    const review = (
      await screen.findByText("awjCheckout.review.heading")
    ).closest("section") as HTMLElement;
    expect(within(review).getByText(/Morning/)).toBeInTheDocument();
    expect(within(review).getByText(/Mona/)).toBeInTheDocument();
    expect(
      within(review).getByText(/awjCheckout\.review\.giftAnonymous/),
    ).toBeInTheDocument();
    expect(within(review).getByText(/Happy birthday/)).toBeInTheDocument();
    expect(
      within(review).getByRole("button", {
        name: "awjCheckout.review.editSchedule",
      }),
    ).toBeInTheDocument();
    expect(
      within(review).getByRole("button", {
        name: "awjCheckout.review.editGift",
      }),
    ).toBeInTheDocument();
  });
});
