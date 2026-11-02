import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../messages/en.json";
import { OrderTrackingLinkCard } from "../OrderTrackingLinkCard";

const issue = vi.fn();
vi.mock("@/lib/data/awj-order-tracking", () => ({ issueTrackingLinkAction: (...a: unknown[]) => issue(...a) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const card = (reference: string | null = "v1.ref") =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <OrderTrackingLinkCard orderId="o1" orderReference={reference} basePath="/sa/en" />
    </NextIntlClientProvider>,
  );

describe("OrderTrackingLinkCard (COPS-H2-5)", () => {
  beforeEach(() => issue.mockReset());
  afterEach(cleanup);

  it("renders nothing when the API issues no link (gate closed or any failure) — the confirmation stays as it was", async () => {
    issue.mockResolvedValue({ success: false });
    const { container } = card();
    await waitFor(() => expect(issue).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("does not even ask without an order reference", () => {
    const { container } = card(null);
    expect(issue).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("offers the link as a path under the shopper's base path, and never prints the order reference", async () => {
    issue.mockResolvedValue({ success: true, token: "trk1.a.b.c", expiresAt: null });
    const { container } = card("v1.secret-reference");
    const open = await screen.findByRole("link", { name: "Open tracking page" });
    expect(open.getAttribute("href")).toBe("/sa/en/track/trk1.a.b.c");
    expect(issue).toHaveBeenCalledWith("o1", "v1.secret-reference");
    expect(container.textContent).not.toContain("secret-reference");
  });

  it("copies the absolute link", async () => {
    issue.mockResolvedValue({ success: true, token: "trk1.a.b.c", expiresAt: null });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    card();
    fireEvent.click(await screen.findByRole("button", { name: /Copy link/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/sa/en/track/trk1.a.b.c`));
    await screen.findByText("Link copied");
  });
});
