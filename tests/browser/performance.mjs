// Same deterministic stress fixture against baseline and candidate on one CI runner.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const browser=await chromium.launch();
const label=process.env.PERF_LABEL || 'candidate';
const output=process.env.PERF_OUTPUT || 'performance-results';
await mkdir(output,{recursive:true});
const page=await browser.newPage({viewport:{width:1000,height:800}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const client=await page.context().newCDPSession(page);
await client.send('Performance.enable');
await client.send('Emulation.setCPUThrottlingRate',{rate:4});
await page.route(/https?:\/\/(?!localhost:5173)/,route=>route.fulfill({json:[]}));
const snapshot=async()=>Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
const measure=async(action)=>{
  await page.evaluate(()=>{window.__ibProfile=[];});
  const before=await snapshot();await action();const after=await snapshot();
  return {scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,
    layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,
    styleMs:(after.RecalcStyleDuration-before.RecalcStyleDuration)*1000,
    taskMs:(after.TaskDuration-before.TaskDuration)*1000,
    layouts:after.LayoutCount-before.LayoutCount,
    reactRenderMs:await page.evaluate(()=>window.__ibProfile.reduce((sum,row)=>sum+row.duration,0))};
};
try {
  const before=await snapshot();
  await page.goto('http://localhost:5173/tests/browser/index.html?navigator=1&performance=1');
  await page.locator('.ib-release-panel table').first().waitFor();
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(700);
  const after=await snapshot();
  const mount={scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,
    nodes:(await client.send('Memory.getDOMCounters')).nodes,
    cards:await page.locator('.ib-release-panel').count(),matrices:await page.locator('.ib-release-panel .ib-comparison-matrix').count()};
  if(label==='candidate'){
    assert.equal(await page.locator('.ib-deferred-matrix').count(),mount.cards,'candidate server serves the optimized revision');
    assert.ok(mount.matrices<mount.cards,'distant matrices are deferred');
  }
  const navigation=await measure(async()=>{
    for(let i=0;i<3;i++){
      await page.getByRole('button',{name:'Show releases',exact:true}).click();
      await page.getByRole('dialog',{name:'Jump to release',exact:true}).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog',{name:'Jump to release',exact:true}).waitFor({state:'hidden'});
    }
  });
  const scroll=await measure(async()=>{
    await page.locator('.ib-release-panel .ib-comparison-matrix .ib-table-responsive').first().evaluate(async el=>{
      el.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,isPrimary:true}));
      el.scrollLeft=200;await new Promise(r=>setTimeout(r,60));
      let writes=0;const observer=new MutationObserver(rows=>writes+=rows.length);
      observer.observe(el,{attributes:true,attributeFilter:['style']});
      for(let i=0;i<40;i++){await new Promise(requestAnimationFrame);el.scrollLeft=200+i*5;}
      observer.disconnect();window.__ibRailWrites=writes;
      window.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,isPrimary:true}));
    });
    await page.waitForTimeout(950);
  });
  scroll.railStyleWrites=await page.evaluate(()=>window.__ibRailWrites);
  const search=await measure(async()=>{
    await page.locator('#gpu-relvals-toggle').first().click();
    const input=page.locator('.ib-test-dropdown.show input');
    for(const text of ['N','NV','NVI','NVID','NVIDIA','NVIDIA_GPU4','']){await input.fill(text);await page.waitForTimeout(60);}
    await page.locator('#gpu-relvals-toggle').first().click();
  });
  const density=await measure(async()=>{
    for(const name of ['Compact','Comfortable','Compact','Comfortable']){
      await page.getByRole('button',{name,exact:true}).click();await page.waitForTimeout(250);
    }
  });
  assert.deepEqual(errors,[]);
  const report={label,fixture:'20 cards, 80 GPU results per dropdown, Chromium, 4x CPU slowdown, Vite development mode',mount,navigation,scroll,search,density};
  await writeFile(output+'/'+label+'.json',JSON.stringify(report,null,2));
  console.log('PERFORMANCE_REPORT '+JSON.stringify(report));
}finally{await browser.close();}
