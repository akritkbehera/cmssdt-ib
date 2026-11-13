import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';
const engine=process.env.IB_BROWSER||'chromium';
const browser=await ({chromium,firefox,webkit}[engine]).launch();
try {
  const page=await browser.newPage({viewport:{width:1366,height:936}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:5173/tests/browser/index.html?review=1&dropdowns=1');
  try { await page.getByRole('button',{name:'Dashboard help',exact:true}).waitFor({timeout:10000}); }
  catch(error){ throw new Error('Review fixture failed: '+JSON.stringify(errors)+'; '+(await page.locator('body').innerText()).slice(0,800),{cause:error}); }
  assert.ok(await page.getByRole('button',{name:'Report an issue',exact:true}).isVisible());
  await page.getByRole('button',{name:'Compact',exact:true}).click();
  const upcoming=page.locator('.ib-release-panel--upcoming');
  assert.equal(await upcoming.locator('.ib-release-panel-body').count(),0,'upcoming has no empty body');
  assert.ok((await upcoming.boundingBox()).height<=70,'upcoming stays a single compact strip');
  const card=page.locator('.ib-release-panel').filter({has:page.locator('.ib-comparison-matrix')}).first();
  const matrix=card.locator('.ib-comparison-matrix');
  assert.equal(await matrix.getByRole('rowheader').count(),5,'all stages expose row headings');
  assert.ok(await matrix.getByRole('rowheader',{name:'RelVal',exact:true}).isVisible());
  const duplicates=await page.locator('[id]').evaluateAll(elements=>{
    const counts=new Map();elements.forEach(el=>counts.set(el.id,(counts.get(el.id)||0)+1));
    return [...counts].filter(([id,count])=>count>1);
  });
  assert.deepEqual(duplicates,[],'every rendered DOM id is unique across cards');
  const dropdown=card.getByTestId('gpu-qa-toggle');
  await dropdown.click();
  const toggleId=await dropdown.getAttribute('id');
  const menu=card.locator('.ib-test-dropdown.show');
  assert.equal(await menu.getAttribute('aria-labelledby'),toggleId,'menu names its own toggle');
  await dropdown.click();
  const short=page.getByTestId('short-label').locator('.ib-overflow-label');
  const resized=page.getByTestId('resize-label').locator('.ib-overflow-label');
  await page.waitForFunction(()=>document.querySelector('[data-testid="resize-label"] .ib-overflow-label')?.classList.contains('is-scrolling'));
  await page.getByRole('button',{name:'Give label room',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-testid="resize-label"] .ib-overflow-label')?.classList.contains('is-scrolling'));
  assert.ok(!(await short.getAttribute('class')).includes('is-scrolling'),'ordinary labels remain static');
  assert.equal(await resized.locator('.ib-overflow-repeat').evaluate(el=>getComputedStyle(el).display),'none','fitting labels hide duplicate copy');
  await page.waitForFunction(()=>document.querySelector('[data-testid="long-label"] .ib-overflow-label')?.classList.contains('is-scrolling'));
  const clang=matrix.locator('.ib-family-header').filter({has:page.getByRole('link',{name:'CLANG',exact:true})});
  const clangLabel=clang.locator('.ib-overflow-label');
  await page.waitForFunction(()=>[...document.querySelectorAll('.ib-family-header .ib-overflow-label')].some(el=>el.title==='CLANG'&&!el.classList.contains('is-scrolling')));
  assert.ok(!(await clangLabel.getAttribute('class')).includes('is-scrolling'),'CLANG fits without a marquee in compact desktop');
  assert.deepEqual(errors,[]);
  console.log('REVIEW_CHECKS '+engine+' passed');
}finally{await browser.close();}
