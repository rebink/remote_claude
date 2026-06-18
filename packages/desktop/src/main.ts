import { mount } from "svelte";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App.svelte";

// The window starts hidden (tauri.conf `visible: false`) so the white WKWebView
// never shows during load. Reveal it now that the dark splash markup is in the
// DOM and about to paint — the user only ever sees the dark splash, no flash.
requestAnimationFrame(() => {
  getCurrentWindow().show().catch(() => {});
});

const app = mount(App, {
  target: document.getElementById("app")!,
});

// Fade out the launch splash once the app has mounted (one frame later so the
// app's first paint lands before the splash clears — avoids a flash of empty UI).
const splash = document.getElementById("splash");
if (splash) {
  requestAnimationFrame(() => {
    splash.classList.add("hide");
    setTimeout(() => splash.remove(), 300);
  });
}

export default app;
