/** Let React's mount effects settle before the first synthetic user action. */
export async function clickSignIn() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const button = [...document.querySelectorAll('button')].find(b => !b.disabled && b.textContent.trim() === 'Sign in with Plex');
    if (button) {
      // A DOM match alone can precede StrictMode's initial effect cleanup,
      // which aborts any sign-in attempt started before the first paint.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise(resolve => setTimeout(resolve, 100));
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (button.isConnected && !button.disabled && rect.width > 0 && rect.height > 0 && hit && button.contains(hit)) {
        button.click(); return;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('sign-in-not-ready');
}
