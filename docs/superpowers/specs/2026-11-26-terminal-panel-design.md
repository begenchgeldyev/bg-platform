# VS Code–style Terminal panel

## Scope

Make the decorative `>_` in the public header open the portfolio Terminal without navigating away. Enable it on Resume, Logs, Projects, and individual Project pages. The home page keeps its inline Terminal and current fullscreen behavior. Admin keeps its current header and does not get a panel.

The panel presents the existing Terminal, not a new assistant or a way to run system commands. Commands, completion, transcript, and assistant requests keep their existing behavior.

## Appearance and interaction

- The panel starts closed on each page load. Opening it docks it across the bottom of the viewport, with the current page still visible and usable above it. It does not dim the page or trap focus. Keep the terminal body independently scrollable and leave enough space for visitors to scroll the page's last content above the dock.
- Borrow VS Code's compact panel layout, not its color scheme: use the site's dark surfaces, monospace type, and green accent. Put a **Terminal** label on the left and the existing four-corner fullscreen icon and an **×** on the right. Localize the title and control labels in English and Russian. Keep the launcher and controls usable at narrow widths and with touch.
- The header button toggles the panel and exposes its open state. Opening sends keyboard focus to the Terminal; closing from the panel returns focus to the launcher. Closing and reopening on the same page preserves the transcript, draft, and command history. Navigation and reload do not carry them to another page. Do not store Terminal content in browser storage.
- The four-corner button requests native browser fullscreen for the Terminal. Restore or Escape returns to the dock, with the launcher still in its open state and the Terminal content unchanged. If native fullscreen is unavailable or denied, the panel fills the viewport instead; the same restore controls work there. Escape in the regular dock does not close it. The **×** closes the panel from either size; if fullscreen must first exit, restore focus to the launcher after that exit.

## Implementation boundaries

Use the existing SSR layout rules to opt eligible pages into the header button and bottom panel. Mount one Terminal per document. Share the Terminal body and its runtime between the home and panel presentations rather than duplicating commands or assistant wiring. Keep open, close, and viewport expansion as panel concerns; reuse the existing native fullscreen behavior without changing its home-page contract. The dock does not depend on fetching a fragment or calling a new endpoint. If JavaScript is disabled, keep the dock hidden and do not present an inoperative launcher.

No new routes, dependencies, authorization changes, assistant configuration, VS Code–style tabs, resize handles, or terminal sessions are part of this change.

## Verification

- Add focused SSR checks for public route eligibility, one Terminal per page, English and Russian controls, and Admin exclusion.
- Extend local browser coverage for opening and closing from mouse and keyboard, focus return, usable narrow layout, same-page state retention, native fullscreen and Escape, and viewport fallback when native fullscreen is unavailable or rejected. Keep the existing home fullscreen checks passing. Use a local command such as `help` rather than submitting an AI request.
- Run the root Bun tests and lint; run the relevant browser checks against a local preview. Do not access production or make Admin writes for verification.
