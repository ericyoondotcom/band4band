const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

class WebSocketClient {
  constructor() {
    this.socket = null;
    this.listeners = {};

    // Reconnection state
    this._connectUrl = null;
    this._retryCount = 0;
    this._retryTimer = null;
    this._intentionalClose = false;
    this._promiseHandlers = null; // { resolve, reject } for the initial connect()
  }

  /**
   * Connect (or reconnect) to the given WebSocket URL.
   * Returns a Promise that resolves on the first successful open, or rejects
   * after the initial connection attempt fails (before any retries).
   */
  connect(url) {
    this._connectUrl = url;
    this._intentionalClose = false;
    this._retryCount = 0;

    return new Promise((resolve, reject) => {
      this._promiseHandlers = { resolve, reject };
      this._openSocket(url);
    });
  }

  /**
   * Attempt a reconnect using the stored reconnectId + roomCode from sessionStorage
   * instead of the original action (host/join).
   */
  _buildReconnectUrl() {
    const reconnectId = sessionStorage.getItem('b4b_reconnectId');
    const roomCode = sessionStorage.getItem('b4b_roomCode');
    if (!reconnectId || !roomCode || !this._connectUrl) return null;

    // Derive the base WS URL (everything before the '?')
    const base = this._connectUrl.split('?')[0];
    return `${base}?action=reconnect&code=${roomCode}&reconnectId=${reconnectId}`;
  }

  _openSocket(url) {
    this.socket = new WebSocket(url);
    let settled = false;

    this.socket.onopen = () => {
      console.log('[WS] Connected');
      this._retryCount = 0;
      if (this._promiseHandlers && !settled) {
        settled = true;
        this._promiseHandlers.resolve();
        this._promiseHandlers = null;
      }
      // If this was a reconnect attempt, notify listeners
      if (this._retryCount > 0 || url.includes('action=reconnect')) {
        this.triggerEvent('RECONNECT_SUCCESS');
      }
    };

    this.socket.onerror = (error) => {
      console.error('[WS] Error:', error);
      // Only reject the initial promise; subsequent failures are handled by onclose
      if (this._promiseHandlers && !settled) {
        settled = true;
        this._promiseHandlers.reject(error);
        this._promiseHandlers = null;
      }
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Persist session token so we can reconnect after a drop
        if (data.type === 'SESSION_TOKEN' || data.type === 'RECONNECTED') {
          if (data.reconnectId) sessionStorage.setItem('b4b_reconnectId', data.reconnectId);
          if (data.roomCode) sessionStorage.setItem('b4b_roomCode', data.roomCode);
        }

        this.triggerEvent(data.type, data);
      } catch (err) {
        console.error('[WS] Error parsing message', err);
      }
    };

    this.socket.onclose = () => {
      console.log('[WS] Disconnected');
      if (this._intentionalClose) {
        this.triggerEvent('DISCONNECT');
        return;
      }
      this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    if (this._retryCount >= MAX_RETRIES) {
      console.error('[WS] Max retries reached. Giving up.');
      this._clearSession();
      this.triggerEvent('DISCONNECT');
      return;
    }

    this._retryCount++;
    const delay = BASE_DELAY_MS * Math.pow(2, this._retryCount - 1); // 1s, 2s, 4s, 8s, 16s
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this._retryCount}/${MAX_RETRIES})...`);

    this.triggerEvent('RECONNECTING', { attempt: this._retryCount, maxRetries: MAX_RETRIES, delayMs: delay });

    this._retryTimer = setTimeout(() => {
      const reconnectUrl = this._buildReconnectUrl();
      const url = reconnectUrl || this._connectUrl;
      console.log(`[WS] Attempting reconnect to: ${url}`);
      this._openSocket(url);
    }, delay);
  }

  /**
   * Gracefully close the connection and clear stored session.
   */
  disconnect() {
    this._intentionalClose = true;
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    this._clearSession();
    if (this.socket) {
      this.socket.close();
    }
  }

  _clearSession() {
    sessionStorage.removeItem('b4b_reconnectId');
    sessionStorage.removeItem('b4b_roomCode');
  }

  send(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    } else {
      console.error('[WS] Cannot send message, socket is not open.');
    }
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  triggerEvent(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }
}

export const wsClient = new WebSocketClient();
