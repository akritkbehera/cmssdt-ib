import { useEffect } from 'react';

export default function useMatrixScroll(containerRef, version) {
  useEffect(() => {
    const container=containerRef.current, table=container?.querySelector('table');
    if(!table)return;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    const rtl=getComputedStyle(container).direction==='rtl';
    const read=()=>rtl?-container.scrollLeft:container.scrollLeft;
    const write=x=>{container.scrollLeft=rtl?-x:x;};
    let animation, paintFrame, idle, revealTimer, pointerDown=false, disposed=false, dirty=true;
    let stage=88, minimumRail=68, overflow=false, samples=[], previousShrink, previousProgress;
    const paint=x=>{
      const progress=overflow?Math.max(0,Math.min(1,x/Math.max(1,stage*1.5))):0;
      const shrink=(Math.max(0,stage-Math.min(stage,minimumRail))*progress).toFixed(3)+'px';
      if(shrink!==previousShrink){container.style.setProperty('--ib-rail-shrink',shrink);previousShrink=shrink;}
      if(progress!==previousProgress){container.style.setProperty('--ib-rail-progress',String(progress));previousProgress=progress;}
    };
    // All geometry reads precede style writes, and native events share one frame.
    const schedulePaint=(invalidate=false)=>{
      dirty ||= invalidate;
      if(paintFrame!==undefined || disposed)return;
      paintFrame=requestAnimationFrame(()=>{
        paintFrame=undefined;
        if(dirty){
          const style=getComputedStyle(table);
          stage=parseFloat(style.getPropertyValue('--ib-stage-width'))||88;
          minimumRail=parseFloat(style.getPropertyValue('--ib-rail-min-width'))||Math.max(68,stage*.7);
          const originalWidth=parseFloat(style.getPropertyValue('--ib-fit-width'))||table.scrollWidth;
          overflow=originalWidth>container.clientWidth+1;
          dirty=false;
        }
        paint(read());
      });
    };
    const cancel=()=>{cancelAnimationFrame(animation);animation=undefined;clearTimeout(idle);};
    const reveal=()=>{
      if(!container.classList.contains('ib-scroll-interacting'))container.classList.add('ib-scroll-interacting');
      clearTimeout(revealTimer);
      revealTimer=setTimeout(()=>container.classList.remove('ib-scroll-interacting'),1400);
    };
    const targets=()=>{
      const headers=[...table.querySelectorAll('th.ib-config-header')];
      const rail=table.querySelector('.name-column')?.getBoundingClientRect().width||0;
      const origin=container.getBoundingClientRect(),current=read(),max=Math.max(0,container.scrollWidth-container.clientWidth);
      return [...new Set([0,...headers.map(header=>{
        const r=header.getBoundingClientRect(),distance=rtl?origin.right-r.right:r.left-origin.left;
        return Math.max(0,Math.min(max,current+distance-rail));
      }),max])].sort((a,b)=>a-b);
    };
    const settle=()=>{
      if(pointerDown || animation!==undefined || !container.getClientRects().length)return;
      const stops=targets(),start=read();
      if(stops.length<2)return;
      const recent=samples.filter(s=>performance.now()-s.time<260),first=recent[0],last=recent.at(-1);
      const velocity=first&&last&&last.time>first.time?(last.x-first.x)/(last.time-first.time):0;
      const projected=start+Math.max(-36,Math.min(36,velocity*80));
      const end=stops.reduce((best,x)=>Math.abs(x-projected)<Math.abs(best-projected)?x:best,stops[0]);
      if(Math.abs(end-start)<.75)return;
      if(reduced.matches){write(end);paint(end);return;}
      const began=performance.now(),duration=Math.min(700,420+Math.abs(end-start)*3);
      cancelAnimationFrame(paintFrame);paintFrame=undefined;
      const tick=now=>{
        const t=Math.min(1,(now-began)/duration),x=start+(end-start)*(1-Math.pow(1-t,3));
        write(x);paint(x);
        if(t<1)animation=requestAnimationFrame(tick);else{animation=undefined;samples=[];}
      };
      animation=requestAnimationFrame(tick);
    };
    const schedule=()=>{clearTimeout(idle);if(!pointerDown&&animation===undefined)idle=setTimeout(settle,180);};
    const scroll=()=>{
      reveal();
      if(animation===undefined){
        schedulePaint();
        const now=performance.now();samples=[...samples.filter(s=>now-s.time<260),{x:read(),time:now}];schedule();
      }
    };
    const down=()=>{reveal();cancel();pointerDown=true;samples=[];};
    const up=event=>{if(event.pointerType==='touch')return;if(pointerDown){pointerDown=false;schedule();}};
    // Native panning cancels pointer events before the finger lifts. Touch
    // lifecycle, rather than pointercancel, owns the snap lock on phones.
    const touchStart=()=>{reveal();cancel();pointerDown=true;samples=[];};
    const touchEnd=event=>{if(!event.touches.length){pointerDown=false;schedule();}};
    const wheel=()=>{cancel();schedulePaint();schedule();};
    const key=e=>{if(['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(e.key))wheel();};
    const resize=new ResizeObserver(()=>{cancel();samples=[];schedulePaint(true);schedule();});
    resize.observe(container);
    const mutations=new MutationObserver(()=>schedulePaint(true));
    mutations.observe(table,{attributes:true,attributeFilter:['style']});
    container.classList.add('ib-scroll-morph');schedulePaint(true);
    container.addEventListener('scroll',scroll,{passive:true});container.addEventListener('pointerdown',down,{passive:true});
    window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
    container.addEventListener('touchstart',touchStart,{passive:true});
    window.addEventListener('touchend',touchEnd,{passive:true});window.addEventListener('touchcancel',touchEnd,{passive:true});
    container.addEventListener('wheel',wheel,{passive:true});container.addEventListener('keydown',key);
    return ()=>{
      disposed=true;cancel();cancelAnimationFrame(paintFrame);clearTimeout(revealTimer);resize.disconnect();mutations.disconnect();
      container.removeEventListener('scroll',scroll);container.removeEventListener('pointerdown',down);
      window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);
      container.removeEventListener('touchstart',touchStart);
      window.removeEventListener('touchend',touchEnd);window.removeEventListener('touchcancel',touchEnd);
      container.removeEventListener('wheel',wheel);container.removeEventListener('keydown',key);
      container.classList.remove('ib-scroll-morph','ib-scroll-interacting');
      container.style.removeProperty('--ib-rail-shrink');container.style.removeProperty('--ib-rail-progress');
    };
  },[containerRef,version]);
}
