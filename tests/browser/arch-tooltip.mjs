import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';
const engine=process.env.IB_BROWSER||'chromium';
const browser=await ({chromium,firefox,webkit}[engine]).launch();
try{
  for(const [width,height] of [[1366,620],[680,480],[390,844],[320,568],[1280,360]]){
    const page=await browser.newPage({viewport:{width,height}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://localhost:5173/tests/browser/index.html?archtooltips=1');
    const card=page.locator('.ib-release-panel').first();
    if(width<768)await card.getByRole('button',{name:'Compare configurations',exact:true}).click();
    const links=card.locator('.ib-comparison-matrix a.ib-config-content');
    for(const index of [0,1]){
      const link=links.nth(index);await link.scrollIntoViewIfNeeded();
      assert.equal(await link.locator('.ib-architecture-header').getAttribute('title'),null,'custom details do not compete with a native tooltip');
      await link.hover();
      const popup=page.locator('.ib-arch-tooltip');await popup.waitFor({state:'visible'});
      await page.waitForTimeout(250);
      const box=await popup.boundingBox();
      assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,
        'full and long patch details stay within viewport: '+JSON.stringify({engine,width,height,index,box}));
      assert.ok((await popup.innerText()).includes(index===0?'Full Build:':'Patch Build:'));
      assert.ok(await popup.locator('.tooltip-inner').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'long tags wrap without horizontal overflow');
      const inner=popup.locator('.tooltip-inner');
      if(await inner.evaluate(el=>el.scrollHeight>el.clientHeight+1)){
        await inner.hover();await page.mouse.wheel(0,160);await page.waitForTimeout(300);
        assert.ok(await popup.isVisible(),'scrollable details remain open while hovered');
        assert.ok(await inner.evaluate(el=>el.scrollTop)>0,'oversized tag details can be scrolled');
      }
      await page.mouse.move(1,1);await popup.waitFor({state:'hidden'});
    }
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('ARCH_TOOLTIP '+engine+' passed');
}finally{await browser.close();}
