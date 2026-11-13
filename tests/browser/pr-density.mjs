import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';
const engine=process.env.IB_BROWSER||'chromium';
const browser=await ({chromium,firefox,webkit}[engine]).launch();
try{
  for(const [width,height] of [[1366,620],[1440,900],[390,844]]){
    const page=await browser.newPage({viewport:{width,height},hasTouch:width<768});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://localhost:5173/tests/browser/index.html?navigator=1');
    const card=page.locator('.ib-release-panel').first();await card.waitFor();
    const geometry=()=>card.evaluate(card=>{
      const phone=innerWidth<768;
      const table=card.querySelector(phone?'.ib-phone-stage-rail':'.ib-comparison-matrix table');
      return {height:table.getBoundingClientRect().height,rows:[...table.tBodies[0].rows].map(row=>row.getBoundingClientRect().height)};
    });
    const closeMenu=async()=>{
      const toggle=page.locator('.navbar-toggler');
      if(await toggle.isVisible()&&await toggle.getAttribute('aria-expanded')==='true')await toggle.click();
    };
    const togglePRs=async name=>{
      const button=page.getByRole('button',{name,exact:true});
      if(!await button.isVisible())await page.locator('.navbar-toggler').click();
      await button.click();await closeMenu();
    };
    for(const density of ['Compact','Comfortable']){
      await closeMenu();
      await page.getByRole('button',{name:density,exact:true}).click();
      await page.waitForTimeout(350);
      const before=await geometry();
      await togglePRs('Show PRs for all releases');
      await page.waitForFunction(()=>document.querySelector('.ib-release-panel').dataset.prVisible==='true');
      await page.waitForTimeout(350);
      const after=await geometry();
      assert.equal(await page.locator('.ib-workspace').getAttribute('data-density'),density.toLowerCase());
      assert.equal(await page.evaluate(()=>localStorage.getItem('cms_ib_density')),density.toLowerCase());
      assert.ok(Math.abs(after.height-before.height)<=1,'PR toggle preserves '+density+' matrix height: '+JSON.stringify({engine,width,before,after}));
      assert.ok(after.rows.every((value,i)=>Math.abs(value-before.rows[i])<=1),'PR toggle preserves row spacing');
      await togglePRs('Hide PRs for all releases');
      await page.waitForFunction(()=>document.querySelector('.ib-release-panel').dataset.prVisible==='false');
    }
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PR_DENSITY '+engine+' passed');
}finally{await browser.close();}
