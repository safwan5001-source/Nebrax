/**
 * @vitest-environment jsdom
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "../alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../sheet";

afterEach(cleanup);

/**
 * CUST-HV V5e-2b review — overlays portal to `document.body` by default, outside the published
 * theme wrapper, so a quick view / cart drawer lost the merchant's colours, fonts and button
 * tokens when it opened. They now portal into the wrapper when there is one.
 */
const overlays: Array<[string, string, () => React.ReactElement]> = [
  [
    "Dialog",
    '[data-slot="dialog-content"]',
    () => (
      <Dialog open>
        <DialogContent>
          <DialogTitle>t</DialogTitle>
          <DialogDescription>d</DialogDescription>
        </DialogContent>
      </Dialog>
    ),
  ],
  [
    "Sheet",
    '[data-slot="sheet-content"]',
    () => (
      <Sheet open>
        <SheetContent>
          <SheetTitle>t</SheetTitle>
          <SheetDescription>d</SheetDescription>
        </SheetContent>
      </Sheet>
    ),
  ],
  [
    "AlertDialog",
    '[data-slot="alert-dialog-content"]',
    () => (
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>t</AlertDialogTitle>
          <AlertDialogDescription>d</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>
    ),
  ],
  [
    "Popover",
    '[data-slot="popover-content"]',
    () => (
      <Popover open>
        <PopoverTrigger>open</PopoverTrigger>
        <PopoverContent>body</PopoverContent>
      </Popover>
    ),
  ],
  [
    "DropdownMenu",
    '[data-slot="dropdown-menu-content"]',
    () => (
      <DropdownMenu open>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>one</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  ],
];

describe("overlays follow the published theme (V5e-2b review)", () => {
  for (const [name, selector, element] of overlays) {
    it(`${name} content lives inside [data-published-theme] when there is one`, async () => {
      const { container } = render(
        <div data-published-theme="" data-gt="b-pri">
          {element()}
        </div>,
      );
      const wrapper = container.firstElementChild as HTMLElement;
      // the wrapper is not in the document during the first render: the container resolves right after mount
      await waitFor(() => {
        const content = document.querySelector(selector);
        expect(content, `${name} content`).not.toBeNull();
        expect(wrapper.contains(content), `${name} inside the wrapper`).toBe(
          true,
        );
      });
    });

    it(`${name} content stays on document.body with no theme wrapper (today's behaviour)`, () => {
      const { container } = render(<div>{element()}</div>);
      const content = document.querySelector(selector);
      expect(content, `${name} content`).not.toBeNull();
      expect(container.contains(content)).toBe(false);
      expect(document.body.contains(content)).toBe(true);
    });
  }
});
