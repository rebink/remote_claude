import { mount } from "svelte";
import App from "./App.svelte";

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
