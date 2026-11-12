import React, {useLayoutEffect, useRef, useState} from 'react';

/** Mount once near the viewport. Keep mounted thereafter to preserve scroll and filter state. */
export default function DeferredMatrix({children}) {
  const root = useRef(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const el=root.current;
    const reveal=()=>setReady(true);
    el.addEventListener('ib:reveal', reveal);
    if (typeof IntersectionObserver === 'undefined') reveal();
    const rect=el.getBoundingClientRect();
    if(rect.top < window.innerHeight+700 && rect.bottom > -700) reveal();
    const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){reveal();observer.disconnect();}
    }, {rootMargin:'700px 0px'});
    observer?.observe(el);
    return ()=>{observer?.disconnect();el.removeEventListener('ib:reveal',reveal);};
  }, []);
  return <div ref={root} className="ib-deferred-matrix" data-ready={ready}>
    {ready?children:<div className="ib-matrix-placeholder" aria-label="Build results load when nearby"/>}
  </div>;
}
