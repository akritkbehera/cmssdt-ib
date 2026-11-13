import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';
const engine=process.env.IB_BROWSER||'chromium';
const browser=await ({chromium,firefox,webkit}[engine]).launch();
try{
  for(const [width,height] of [[1366,620],[1440,900],[390,844]]){
    const page=await browser.newPage({viewport:{width,height},hasTouch:width<768});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://localhost:5173/tests/browser/index.html?navigator=1&prproportions=1');
    const card=page.locator('.ib-release-panel').first();await card.waitFor();
    await card.getByRole('button',{name:'Show Pull Requests',exact:true}).click();
    const panel=card.locator('.ib-commits-panel');await panel.locator('.ib-pr-row').first().waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('.ib-commits-panel .ib-pr-label').length>=3);
    const measure=()=>panel.evaluate(panel=>{
      const row=panel.querySelector('.ib-pr-row'),title=row.querySelector('.ib-pr-title'),pane=panel.querySelector('.tab-pane.active');
      return {height:panel.getBoundingClientRect().height,row:row.getBoundingClientRect().height,
        font:parseFloat(getComputedStyle(title).fontSize),tab:parseFloat(getComputedStyle(panel.querySelector('.nav-link')).fontSize),
        topGap:row.getBoundingClientRect().top-pane.getBoundingClientRect().top,
        action:row.querySelector('.ib-pr-action').getBoundingClientRect().height};
    });
    await page.getByRole('button',{name:'Comfortable',exact:true}).click();await page.waitForTimeout(300);
    const comfortable=await measure();
    await page.getByRole('button',{name:'Compact',exact:true}).click();await page.waitForTimeout(300);
    const compact=await measure();
    assert.ok(compact.height<comfortable.height,'compact reduces the whole PR section: '+JSON.stringify({engine,width,comfortable,compact}));
    assert.ok(compact.font>=12&&compact.font<=13.1&&compact.tab<=13,'compact PR text matches matrix-scale typography');
    const distFont=await panel.locator('#cmsdist-dropdown').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
    assert.ok(Math.abs(distFont-compact.tab)<=0.5,'CMS Dist and flavour tabs share the same density');
    assert.ok(compact.topGap<=10,'empty heading does not add a blank band above PR rows');
    if(width>=1024){
      assert.ok(compact.row<comfortable.row,'compact row spacing reduces');
      const heading=await card.locator('.ib-build-identity strong').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
      assert.ok(heading>=14&&heading>=compact.font,'build identity stays stronger than PR titles');
    }else assert.ok(compact.action>=44,'phone PR controls remain touchable');
    assert.equal(await panel.locator('.tab-pane.active .ib-pr-row').count(),3,'all PRs remain visible');
    assert.equal(await card.getAttribute('data-pr-visible'),'true');
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PR_PROPORTIONS '+engine+' passed');
}finally{await browser.close();}
