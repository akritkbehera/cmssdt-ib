import {useEffect, useRef, useState} from 'react';

/** Native wheel scrolling, with pointer-driven header dragging and shared settling. */
export default function useHistoryNavigation(version) {
  const track = useRef(null), controller = useRef(null);
  const [position, setPosition] = useState({active:0, atEnd:false});
  useEffect(() => {
    const el=track.current;
    if (!el) return;
    let frame, drag;
    const stops=()=>[...el.children].map(child=>Math.min(el.scrollWidth-el.clientWidth, child.offsetLeft-el.children[0].offsetLeft));
    const update=()=>{
      const points=stops();
      let active=0;
      points.forEach((x,i)=>{if(Math.abs(x-el.scrollLeft)<Math.abs(points[active]-el.scrollLeft))active=i;});
      setPosition(previous => previous.active===active && previous.atEnd===(el.scrollLeft+el.clientWidth>=el.scrollWidth-2)
        ? previous : {active,atEnd:el.scrollLeft+el.clientWidth>=el.scrollWidth-2});
    };
    const cancel=()=>{cancelAnimationFrame(frame);frame=undefined;};
    const settle=index=>{
      cancel();
      const points=stops(), end=points[Math.max(0,Math.min(points.length-1,index))] || 0;
      const start=el.scrollLeft, began=performance.now();
      el.style.scrollSnapType='none';
      const finish=()=>{el.scrollLeft=end;el.style.removeProperty('scroll-snap-type');update();};
      if(matchMedia('(prefers-reduced-motion: reduce)').matches){finish();return;}
      const tick=now=>{
        const t=Math.min(1,(now-began)/320);
        el.scrollLeft=start+(end-start)*(1-Math.pow(1-t,3));
        if(t<1)frame=requestAnimationFrame(tick);else{frame=undefined;finish();}
      };
      frame=requestAnimationFrame(tick);
    };
    controller.current=step=>{
      const points=stops();let nearest=0;
      points.forEach((x,i)=>{if(Math.abs(x-el.scrollLeft)<Math.abs(points[nearest]-el.scrollLeft))nearest=i;});
      settle(nearest+step);
    };
    const down=e=>{
      if(!e.isPrimary || e.button!==0 || !e.target.closest('.ib-history-date-handle'))return;
      cancel();el.style.scrollSnapType='none';
      drag={id:e.pointerId,x:e.clientX,y:e.clientY,start:el.scrollLeft,locked:false};
    };
    const move=e=>{
      if(!drag || drag.id!==e.pointerId)return;
      const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
      if(!drag.locked){
        if(Math.abs(dy)>8 && Math.abs(dy)>Math.abs(dx)){drag=null;el.style.removeProperty('scroll-snap-type');return;}
        if(Math.abs(dx)<8)return;
        drag.locked=true;el.setPointerCapture(e.pointerId);
      }
      el.scrollLeft=drag.start-dx;
    };
    const up=e=>{
      if(!drag || drag.id!==e.pointerId)return;
      const current=drag;drag=null;
      if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);
      const points=stops();let nearest=0;
      const travelled=el.scrollLeft-current.start;
      const projected=el.scrollLeft+(current.locked ? Math.sign(travelled)*el.clientWidth*.12 : 0);
      points.forEach((x,i)=>{if(Math.abs(x-projected)<Math.abs(points[nearest]-projected))nearest=i;});
      settle(nearest);
    };
    const wheel=()=>{cancel();el.style.removeProperty('scroll-snap-type');};
    el.addEventListener('scroll',update,{passive:true});
    el.addEventListener('pointerdown',down);
    el.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
    window.addEventListener('pointercancel',up);
    el.addEventListener('wheel',wheel,{passive:true});
    const resize=new ResizeObserver(update);resize.observe(el);update();
    return ()=>{
      cancel();controller.current=null;resize.disconnect();el.style.removeProperty('scroll-snap-type');
      el.removeEventListener('scroll',update);el.removeEventListener('pointerdown',down);
      el.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);
      window.removeEventListener('pointercancel',up);el.removeEventListener('wheel',wheel);
    };
  },[version]);
  return {track,...position,move:step=>controller.current?.(step)};
}
