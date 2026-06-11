export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';
export const WS_URL = BACKEND_URL.replace(/^http/, 'ws');
