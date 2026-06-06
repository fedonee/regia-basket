let accessHandle = null;
let offset = 0;

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'init') {
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(
        'recording.mp4', { create: true }
      );
      accessHandle = await fileHandle.createSyncAccessHandle();
      offset = 0;
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }

  if (type === 'chunk') {
    try {
      const buffer = await e.data.blob.arrayBuffer();
      const view = new DataView(buffer);
      accessHandle.write(view, { at: offset });
      accessHandle.flush();
      offset += buffer.byteLength;
      self.postMessage({ type: 'progress', bytes: offset });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }

  if (type === 'stop') {
    try {
      accessHandle.close();
      self.postMessage({ type: 'done', totalBytes: offset });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};
