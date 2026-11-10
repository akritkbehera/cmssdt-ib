import React, { useLayoutEffect, useRef, useState } from 'react';

export default function OverflowLabel({ text }) {
  const viewport = useRef(null);
  const label = useRef(null);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      if (viewport.current && label.current) {
        setOverflow(label.current.getBoundingClientRect().width > viewport.current.clientWidth + 1);
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current);
    observer.observe(label.current);
    measure();
    document.fonts?.addEventListener('loadingdone', measure);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', measure);
    };
  }, [text]);
  return <span ref={viewport} className={`ib-overflow-label ${overflow ? 'is-scrolling' : ''}`} title={text}>
    <span className="ib-overflow-track">
      <span ref={label}>{text}</span>
      {overflow && <span aria-hidden="true">{text}</span>}
    </span>
  </span>;
}
