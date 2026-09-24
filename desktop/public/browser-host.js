// Tauri sends a Channel's final marker through webview evaluation, outside its
// native channel interceptor. Forward only that marker to release callbacks.
const ipc = window.__TAURI_INTERNALS__;
const original = ipc.runCallback.bind(ipc);
ipc.runCallback = (id, value) => {
  if (value?.end === true && Number.isSafeInteger(value.index)) {
    void ipc
      .invoke("browser_dev_channel_end", { callback: id, index: value.index })
      .catch(console.error);
  } else {
    original(id, value);
  }
};

void ipc.invoke("browser_dev_host_ready").catch(console.error);
