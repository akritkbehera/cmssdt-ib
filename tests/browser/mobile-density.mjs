import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,firefox,webkit} from 'playwright';
const engine=['firefox','webkit'].includes(process.env.IB_BROWSER)?process.env.IB_BROWSER:'chromium';
const browser=await ({chromium,firefox,webkit}[engine]).launch();
await mkdir('mobile-review',{recursive:true});
try {
  for(const width of [320,375,390,430,767]){
    const page=await browser.newPage({viewport:{width,height:844},hasTouch:true});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://localhost:5173/tests/browser/index.html?navigator=1');
    const card=page.locator('.ib-release-panel').first(),rail=card.locator('.ib-phone-stage-rail');
    await rail.waitFor();
    const geometry=()=>card.evaluate(card=>{
      const rail=card.querySelector('.ib-phone-stage-rail'),slide=card.querySelector('.ib-snap-slide[aria-hidden="false"] .ib-phone-column-table');
      const rect=el=>el.getBoundingClientRect();
      return {card:rect(card).height,rail:rect(rail).width,header:rect(rail.tHead).height,
        rows:[...rail.tBodies[0].rows].map(row=>rect(row).height),
        aligned:[...rail.tBodies[0].rows].map((row,i)=>Math.abs(rect(row).top-rect(slide.tBodies[0].rows[i]).top)),
        overflow:document.documentElement.scrollWidth>innerWidth,
        readable:[...card.querySelectorAll('.ib-phone-results .ib-status-count')].every(el=>parseFloat(getComputedStyle(el).fontSize)>=12)};
    });
    const comfortable=await geometry();
    const pillLayout=await card.locator('.ib-section-controls').evaluate(el=>{
      const pills=[...el.querySelectorAll('.ib-section-pill')];
      return {count:pills.length,rows:new Set(pills.map(p=>Math.round(p.getBoundingClientRect().top))).size,
        overflow:el.scrollWidth>el.clientWidth+1};
    });
    assert.ok(!pillLayout.overflow,'analysis pills stay within the phone card');
    if(width>=375 && pillLayout.count<=9)assert.ok(pillLayout.rows<=3,'analysis pills fit three rows: '+JSON.stringify(pillLayout));
    for(const name of ['Build','Unit tests','RelVal','AddOn','Q/A duplicates']){
      const cell=rail.getByRole('rowheader',{name,exact:true});
      assert.equal(await cell.locator('.ib-phone-stage-icon svg').count(),1,'each stage has an accessible icon');
    }
    await page.getByRole('button',{name:'Compact',exact:true}).click();
    const compact=await geometry();
    assert.ok(compact.card<comfortable.card-70,'compact removes substantial vertical whitespace');
    assert.ok(compact.rail<=56 && comfortable.rail<=60,'stage icons do not reserve a third of the screen');
    assert.ok(compact.rows.every(height=>height<=45 && height>=44),'compact keeps 44px result rows');
    assert.ok(compact.aligned.every(error=>error<=1),'pinned icons and results remain vertically aligned: '+JSON.stringify({width,comfortable,compact}));
    assert.ok(!compact.overflow&&compact.readable,'compact has readable counts and no document overflow');
    await page.screenshot({path:`mobile-review/${engine}-${width}-compact.png`,fullPage:false});
    await page.getByRole('button',{name:'Comfortable',exact:true}).click();
    const restored=await geometry();
    assert.deepEqual(restored.rows,comfortable.rows,'comfortable restores original row heights');
    assert.equal(restored.header,comfortable.header);
    assert.equal(await card.locator('.ib-phone-history-action').count(),1,'single view offers its history shortcut');
    await card.getByRole('button',{name:'Compare configurations',exact:true}).click();
    assert.equal(await card.locator('.ib-phone-history-action').count(),0,'show all removes the redundant history shortcut');
    const expanded=card.locator('.ib-comparison-matrix');
    assert.equal(await expanded.locator('.type-header-desktop:visible').count(),0,'phone stage heading uses an icon');
    assert.equal(await expanded.locator('.type-header-mobile > svg').count(),1);
    const collisions=await expanded.locator('.ib-family-header .flavor-card-wrapper').evaluateAll(wrappers=>wrappers.flatMap(wrapper=>{
      const label=wrapper.querySelector(':scope > a, :scope > .flavor-card');
      if(!label)return [];
      const text=label.getBoundingClientRect();
      return [...wrapper.querySelectorAll(':scope > button')].filter(button=>{
        const action=button.getBoundingClientRect();
        return action.width && action.left<text.right-0.5 && action.right>text.left+0.5;
      }).map(button=>button.className);
    }));
    assert.deepEqual(collisions,[],'header actions reserve space without covering flavour labels');

    const historyIcon=card.locator('.ib-comparison-matrix .ib-history-trigger').first();
    assert.ok(await historyIcon.isVisible(),'show all retains the flavour header history icon');
    await historyIcon.click();
    const historyDialog=page.getByRole('dialog',{name:'Build history',exact:true});
    await historyDialog.waitFor({state:'visible'});
    await historyDialog.getByRole('button',{name:'Close',exact:true}).click();
    await historyDialog.waitFor({state:'hidden'});
    assert.ok(await card.locator('.ib-comparison-matrix').isVisible(),'expanded matrix remains available');
    assert.equal(await card.locator('.ib-comparison-matrix tbody .type-label-desktop:visible').count(),0,'expanded phone table uses icons');

    const scrollViewport=expanded.locator('.ib-table-responsive');
    const stage=scrollViewport.locator('tbody .name-column').first();
    const initialStage=await stage.boundingBox();
    const centers=await expanded.locator('tbody .name-column').evaluateAll(cells=>cells.map(cell=>{
      const icon=cell.querySelector('.type-label-mobile svg');
      const rail=cell.getBoundingClientRect(),rect=icon.getBoundingClientRect();
      return Math.abs(rect.left+rect.width/2-rail.left-rail.width/2);
    }));
    assert.ok(centers.every(error=>error<=1),'all stage icons, including linked RelVal, are centered');
    await scrollViewport.scrollIntoViewIfNeeded();
    await scrollViewport.evaluate(el=>{el.scrollLeft=0;});
    await page.waitForTimeout(900);
    const wheelRect=await scrollViewport.boundingBox();
    await page.mouse.move(wheelRect.x+wheelRect.width-35,Math.min(wheelRect.y+75,800));
    await page.mouse.wheel(24,0);
    await page.waitForTimeout(1000);
    assert.ok(await scrollViewport.evaluate(el=>el.scrollLeft)>=18,'a small trackpad gesture is retained rather than snapping back');
    await scrollViewport.evaluate(el=>{el.scrollLeft=0;});
    await page.waitForTimeout(900);

    // Exercise actual native touch input, not only scrollLeft assignment.
    if(engine==='chromium'){
      await scrollViewport.scrollIntoViewIfNeeded();
      const rect=await scrollViewport.boundingBox();
      const client=await page.context().newCDPSession(page);
      const x=rect.x+rect.width-24,y=Math.min(rect.y+100,800);
      await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(let step=1;step<=8;step++){
        await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-step*22,y}]});
        await page.waitForTimeout(25);
      }
      assert.ok(await scrollViewport.evaluate(el=>el.scrollLeft)>30,'finger drag moves the native horizontal table');
      await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await client.detach();
    }
    await scrollViewport.evaluate(el=>{el.scrollLeft=200;});
    await page.waitForFunction(()=>{
      const rail=document.querySelector('.ib-release-panel .ib-comparison-matrix tbody .name-column');
      return rail&&rail.getBoundingClientRect().width<=34;
    });
    const thinStage=await stage.boundingBox();
    assert.ok(thinStage.width>=31 && thinStage.width<initialStage.width,'scroll reclaims the icon-only stage width');
    assert.ok(Math.abs(thinStage.x-initialStage.x)<=1,'thin icon rail remains pinned');
    assert.ok(await stage.locator('.type-label-mobile svg').isVisible(),'stage icon remains visible after compression');
    await page.setViewportSize({width:900,height:600});
    assert.ok(await card.locator('.ib-comparison-matrix tbody .type-label-desktop').first().isVisible(),'tablet/desktop labels restore outside phone breakpoint');
    assert.deepEqual(errors,[]);
    console.log('MOBILE_DENSITY '+JSON.stringify({engine,width,comfortable,compact}));
    await page.close();
  }

  // Reproduce a desktop user narrowing the window, then using Show all.
  const narrow=await browser.newPage({viewport:{width:1280,height:900},hasTouch:false});
  await narrow.goto('http://localhost:5173/tests/browser/index.html?navigator=1');
  const first=narrow.locator('.ib-release-panel').first();
  await first.waitFor();
  await narrow.setViewportSize({width:690,height:900});
  await first.getByRole('button',{name:'Compare configurations',exact:true}).click();
  const viewport=first.locator('.ib-comparison-matrix .ib-table-responsive');
  await viewport.scrollIntoViewIfNeeded();
  const box=await viewport.boundingBox();
  await narrow.mouse.move(box.x+box.width-40,Math.min(box.y+90,850));
  await narrow.mouse.wheel(24,0);
  await narrow.waitForTimeout(1000);
  const small=await viewport.evaluate(el=>el.scrollLeft);
  assert.ok(small>=18,'narrow desktop trackpad movement is not reversed');
  await narrow.mouse.wheel(170,0);
  await narrow.waitForTimeout(1000);
  assert.ok(await viewport.evaluate(el=>el.scrollLeft)>small+60,'narrow desktop supports continued horizontal scrolling');
  await narrow.close();
}finally{await browser.close();}
