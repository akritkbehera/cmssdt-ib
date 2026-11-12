import React, { useLayoutEffect, useRef, useState } from 'react';

export default function OverflowLabel({ text }) {
  const viewport = useRef(null);
  const label = useRef(null);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    let frame, disposed = false;
    const measure = () => {
      if (!disposed && viewport.current && label.current) {
        // Measure only glyphs: marquee spacing must not keep overflow latched.
        const available = viewport.current.clientWidth;
        setOverflow(available > 0 && label.current.getBoundingClientRect().width > available + 1);
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport.current);
    observer.observe(label.current);
    measure();
    document.fonts?.ready.then(() => { if (!disposed) schedule(); });
    document.fonts?.addEventListener('loadingdone', schedule);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', schedule);
    };
  }, [text]);
  return <span ref={viewport} className={`ib-overflow-label ${overflow ? 'is-scrolling' : ''}`} title={text}>
    <span className="ib-overflow-track">
      <span><span ref={label}>{text}</span></span>
      <span className="ib-overflow-repeat" aria-hidden="true">{text}</span>
    </span>
  </span>;
}
