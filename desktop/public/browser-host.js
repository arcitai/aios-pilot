// Tauri sends a Channel's final marker through webview evaluation, outside its
// native channel interceptor. Forward only that marker to release callbacks.
(() => {
  // Wry owns a non-configurable global `ipc`; keep our names local. Tauri's
  // runCallback property is also read-only. Its debug callback Map is mutable.
  const native = window.__TAURI_INTERNALS__;
  const lookup = native.callbacks.get.bind(native.callbacks);
  native.callbacks.get = (id) =>
    lookup(id) ??
    ((value) => {
      if (value?.end === true && Number.isSafeInteger(value.index)) {
        void native
          .invoke("browser_dev_channel_end", {
            callback: id,
            index: value.index,
          })
          .catch(console.error);
      }
    });

  // The page may load while the native setup callback is still resolving the
  // keyring. Keep readiness closed until that callback has installed the state.
  async function ready() {
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        await native.invoke("browser_dev_host_ready");
        return;
      } catch (error) {
        if (attempt === 119) console.error(error);
        else await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  void ready();
})();
