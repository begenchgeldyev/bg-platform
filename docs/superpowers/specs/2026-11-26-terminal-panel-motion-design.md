# Terminal dock motion

Add motion only to opening and closing the bottom panel. Opening slides the dock up from below the viewport; closing slides it back down. Use a `180ms ease` transform and a subtle `150ms ease` opacity transition. Do not animate the page layout, the inline home Terminal, or entry to and return from fullscreen.

The existing open state, scroll reserve, and focus changes take effect immediately. Closing returns focus to the launcher and makes the departing panel non-interactive while it finishes sliding out. Keep the same Terminal mounted, so reversing a transition or reopening the dock does not lose the draft, transcript, or command history.

With reduced motion, or when the browser cannot animate a hidden panel, open and close immediately. The animation must not be required for focus management or for reaching the final open or closed state.

Extend the local Terminal browser checks to verify motion in both directions, immediate focus and interaction state, reopening during a close, and reduced motion. Keep the existing Terminal and home fullscreen checks passing without sending AI requests.
