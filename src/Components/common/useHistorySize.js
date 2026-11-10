import React, { useEffect, useRef, useState } from 'react';

const storageKey = 'cms_ib_history_size';
const defaults = { width: 96 };
const bounded = (value, fallback) => Number.isFinite(value) ? Math.min(98, Math.max(40, value)) : fallback;

export default function useHistorySize() {
  const [size, setSize] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      return { width: bounded(saved?.width, defaults.width) };
    } catch { return defaults; }
  });
  const resizing = useRef(null);
  const update = next => {
    setSize(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Storage can be unavailable. */ }
  };
  useEffect(() => {
    const finish = () => {
      const content = resizing.current;
      if (!content) return;
      resizing.current = null;
      const rect = content.getBoundingClientRect();
      const next = {
        width: bounded(rect.width / window.innerWidth * 100, defaults.width)
      };
      setSize(next);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the current session size. */ }
      content.style.removeProperty('width');
      content.style.removeProperty('height');
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('mouseup', finish);
    window.addEventListener('blur', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('mouseup', finish);
      window.removeEventListener('blur', finish);
    };
  }, []);
  return {
    style: { '--ib-history-width': size.width + 'vw' },
    onPointerDownCapture: event => {
      const content = event.target.closest?.('.modal-content');
      if (!content || !window.matchMedia('(min-width: 768px) and (pointer: fine)').matches) return;
      const rect = content.getBoundingClientRect();
      if (event.clientX >= rect.right - 24 && event.clientY >= rect.bottom - 24) resizing.current = content;
    },
    controls: <details className="ib-history-resize">
      <summary>Resize width</summary>
      <div className="ib-history-resize-options">
        <label>Width <input type="range" min="40" max="98" value={size.width}
          onChange={event => update({ ...size, width: Number(event.target.value) })} /></label>
        <button type="button" className="btn btn-sm btn-light" onClick={() => update(defaults)}>Reset size</button>
      </div>
    </details>
  };
}
