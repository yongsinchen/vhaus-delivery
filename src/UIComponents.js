import React, { useState, useEffect, useCallback, createContext, useContext, useRef, useMemo } from "react";

// ─── Toast System ────────────────────────────────────────────────
const ToastContext = createContext();

const TOAST_STYLES = {
  success: { bg: "bg-emerald-600", icon: "✓" },
  error: { bg: "bg-red-600", icon: "✕" },
  warning: { bg: "bg-amber-500", icon: "⚠" },
  info: { bg: "bg-blue-600", icon: "ℹ" },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = "info", duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type, duration }]);
    if (duration > 0) setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, success: (m) => addToast(m, "success"), error: (m) => addToast(m, "error", 6000), warning: (m) => addToast(m, "warning", 5000), info: (m) => addToast(m, "info") }}>
      {children}
      {/* Toast container */}
      <div className="fixed top-4 right-4 z-[100] space-y-2 pointer-events-none" style={{ maxWidth: 400 }}>
        {toasts.map(t => {
          const style = TOAST_STYLES[t.type] || TOAST_STYLES.info;
          return (
            <div key={t.id} className={`${style.bg} text-white px-4 py-3 rounded-2xl shadow-lg flex items-center gap-3 pointer-events-auto animate-slideIn`}>
              <span className="text-lg flex-shrink-0">{style.icon}</span>
              <span className="text-sm flex-1">{t.message}</span>
              <button onClick={() => removeToast(t.id)} className="text-white/70 hover:text-white text-lg flex-shrink-0">×</button>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .animate-slideIn { animation: slideIn 0.3s ease-out; }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast() { return useContext(ToastContext); }

// ─── Confirm Modal ───────────────────────────────────────────────
const ModalContext = createContext();

export function ModalProvider({ children }) {
  const [modal, setModal] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((message, { title = "Confirm", confirmText = "Confirm", cancelText = "Cancel", variant = "default", inputLabel, inputPlaceholder } = {}) => {
    return new Promise(resolve => {
      resolveRef.current = resolve;
      setModal({ message, title, confirmText, cancelText, variant, inputLabel, inputPlaceholder });
    });
  }, []);

  const close = (result) => {
    setModal(null);
    resolveRef.current?.(result);
    resolveRef.current = null;
  };

  return (
    <ModalContext.Provider value={{ confirm }}>
      {children}
      {modal && <ConfirmModal modal={modal} onClose={close} />}
    </ModalContext.Provider>
  );
}

function ConfirmModal({ modal, onClose }) {
  const [inputVal, setInputVal] = useState("");
  const variantColors = {
    default: "bg-violet-600 hover:bg-violet-700",
    danger: "bg-red-600 hover:bg-red-700",
    warning: "bg-amber-600 hover:bg-amber-700",
  };

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(modal.inputLabel ? null : false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, modal.inputLabel]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => onClose(modal.inputLabel ? null : false)} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-scaleIn">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-900">{modal.title}</h3>
          <button onClick={() => onClose(modal.inputLabel ? null : false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm text-gray-600 whitespace-pre-line">{modal.message}</p>
          {modal.inputLabel && (
            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">{modal.inputLabel}</label>
              <input autoFocus value={inputVal} onChange={e => setInputVal(e.target.value)}
                placeholder={modal.inputPlaceholder || ""}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                onKeyDown={e => e.key === "Enter" && inputVal.trim() && onClose(inputVal.trim())} />
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
          <button onClick={() => onClose(modal.inputLabel ? null : false)}
            className="px-4 py-2 text-sm rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200">{modal.cancelText}</button>
          <button onClick={() => onClose(modal.inputLabel ? (inputVal.trim() || null) : true)}
            disabled={modal.inputLabel && !inputVal.trim()}
            className={`px-5 py-2 text-sm rounded-xl text-white font-medium disabled:opacity-50 ${variantColors[modal.variant] || variantColors.default}`}>{modal.confirmText}</button>
        </div>
      </div>
      <style>{`
        @keyframes scaleIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .animate-scaleIn { animation: scaleIn 0.2s ease-out; }
      `}</style>
    </div>
  );
}

export function useModal() { return useContext(ModalContext); }

// ─── Global Loading Overlay ──────────────────────────────────────
// Full-screen loading for important blocking actions (login, save, company
// switch). Use showLoading("Saving changes…") / hideLoading(), or wrap the
// whole async call in withLoading("Saving changes…", fn) so the overlay is
// always removed even when the call throws.
const LoadingContext = createContext(null);

// Safety net: never let the overlay get stuck forever
const LOADING_TIMEOUT_MS = 30000;

export function LoadingProvider({ children }) {
  const [state, setState] = useState(null); // null | { message }
  const timeoutRef = useRef(null);

  const hideLoading = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    setState(null);
  }, []);

  const showLoading = useCallback((message = "Loading…") => {
    setState({ message });
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setState(null), LOADING_TIMEOUT_MS);
  }, []);

  const setLoadingMessage = useCallback((message) => {
    setState(prev => (prev ? { ...prev, message } : prev));
  }, []);

  // withLoading("Saving…", async () => { ... }) — overlay always cleared
  const withLoading = useCallback(async (message, fn) => {
    showLoading(message);
    try { return await fn(); }
    finally { hideLoading(); }
  }, [showLoading, hideLoading]);

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  return (
    <LoadingContext.Provider value={{ showLoading, hideLoading, setLoadingMessage, withLoading, isLoading: !!state }}>
      {children}
      {state && <LoadingOverlay message={state.message} />}
    </LoadingContext.Provider>
  );
}

export function useLoading() { return useContext(LoadingContext); }

// Standalone full-screen overlay — also usable directly for boot screens
export function LoadingOverlay({ message = "Loading…", subtext }) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="flex flex-col items-center px-8 py-7 rounded-3xl bg-white/95 shadow-2xl mx-4 min-w-[220px]">
        <PulseSpinner />
        <p className="mt-4 text-sm font-semibold text-gray-800 text-center">{message}</p>
        {subtext && <p className="mt-1 text-xs text-gray-400 text-center">{subtext}</p>}
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .animate-fadeIn { animation: fadeIn 0.15s ease-out; }
      `}</style>
    </div>
  );
}

// PulseOS brand spinner — violet ring with pulsing ⚡ core
export function PulseSpinner({ size = 48 }) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full border-4 border-violet-100" />
      <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-violet-600 animate-spin" />
      <span className="animate-pulse" style={{ fontSize: size * 0.4 }}>⚡</span>
    </div>
  );
}

// Full-page boot screen (pre-dashboard) — branded, not overlaying content
export function FullPageLoader({ message = "Loading PulseOS…", subtext }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="flex justify-center mb-4"><PulseSpinner size={56} /></div>
        <p className="text-gray-700 font-semibold">{message}</p>
        {subtext && <p className="text-gray-400 text-sm mt-1">{subtext}</p>}
      </div>
    </div>
  );
}

// ─── Loading Button ──────────────────────────────────────────────
export function LoadingButton({ onClick, loading, disabled, children, className = "", ...props }) {
  return (
    <button onClick={onClick} disabled={loading || disabled} className={`relative ${className}`} {...props}>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </span>
      )}
      <span className={loading ? "opacity-0" : ""}>{children}</span>
    </button>
  );
}

// ─── Skeleton Loader ─────────────────────────────────────────────
export function Skeleton({ className = "h-4 w-full", count = 1 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`bg-gray-200 rounded-xl animate-pulse ${className}`} />
      ))}
    </>
  );
}

// ─── Performance Hooks ───────────────────────────────────────────

// Debounce hook — delays value updates (for search inputs)
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Debounced callback — fires callback after delay of inactivity
export function useDebouncedCallback(callback, delay = 300) {
  const timerRef = useRef(null);
  const cbRef = useRef(callback);
  cbRef.current = callback;
  return useCallback((...args) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => cbRef.current(...args), delay);
  }, [delay]);
}

// Cached fetch — stores results by URL, avoids duplicate calls
const fetchCache = new Map();
export function useCachedFetch() {
  return useCallback(async (url, opts = {}, ttl = 30000) => {
    const key = url + JSON.stringify(opts.body || "");
    const cached = fetchCache.get(key);
    if (cached && Date.now() - cached.time < ttl) return cached.data;
    const res = await fetch(url, opts);
    const data = await res.json();
    fetchCache.set(key, { data, time: Date.now() });
    return data;
  }, []);
}

// Memoized list — prevents rerender when list hasn't actually changed
export function useMemoList(list) {
  const ref = useRef(list);
  return useMemo(() => {
    if (JSON.stringify(ref.current) !== JSON.stringify(list)) ref.current = list;
    return ref.current;
  }, [list]);
}

// Spinner — small inline spinner
export function Spinner({ size = "w-5 h-5", className = "" }) {
  return <div className={`${size} border-2 border-gray-200 border-t-violet-600 rounded-full animate-spin ${className}`} />;
}

// Loading overlay — centered spinner with optional text
export function LoadingState({ text }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="w-8 h-8 border-3 border-gray-200 border-t-violet-600 rounded-full animate-spin mb-3" />
      {text && <p className="text-xs text-gray-400">{text}</p>}
    </div>
  );
}

// Skeleton cards — matches order/service/customer card shape
export function SkeletonCard({ count = 3 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-200 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 bg-gray-200 rounded-lg w-1/3" />
              <div className="h-3 bg-gray-100 rounded-lg w-2/3" />
            </div>
            <div className="h-5 w-16 bg-gray-100 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Skeleton table rows
export function SkeletonTable({ rows = 5, cols = 6 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="animate-pulse">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3"><div className={`h-3 bg-gray-200 rounded-lg ${j === 0 ? "w-20" : j === 1 ? "w-32" : "w-16"}`} /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

// Skeleton drawer
export function SkeletonDrawer() {
  return (
    <div className="px-6 py-4 space-y-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gray-200 rounded-full" />
        <div className="space-y-2 flex-1"><div className="h-4 bg-gray-200 rounded-lg w-1/3" /><div className="h-3 bg-gray-100 rounded-lg w-1/2" /></div>
      </div>
      <div className="grid grid-cols-3 gap-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl" />)}</div>
      <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-12 bg-gray-50 rounded-xl" />)}</div>
    </div>
  );
}
