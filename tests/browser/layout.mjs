import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser = await chromium.launch();
const targets = [[1366,620],[1440,780],[1536,700],[1920,950],[2560,1300]];
const rows=[];
try {
  for (const [width,height] of targets) {
    const page = await browser.newPage({viewport:{width,height}});
    await page.addInitScript(() => localStorage.setItem('cms_ib_density','compact'));
    await page.route(/https?:\/\/(?!localhost:5173)/, route=>route.fulfill({json:[]}));
    const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.goto('http://localhost:5173/tests/browser/index.html');
    await page.locator('.ib-release-panel').first().waitFor();
    const metrics = () => page.evaluate(() => {
      const cards=[...document.querySelectorAll('.ib-release-panel')];
      return {cards:cards.map(card=>{
        const r=card.getBoundingClientRect(), table=card.querySelector('table'), viewport=card.querySelector('.ib-table-responsive');
        return {height:r.height,top:r.top,bottom:r.bottom,scrollHeight:card.scrollHeight,
          parts:Object.fromEntries(['.ib-release-panel-header','.ib-comparison-context','.ib-section-controls','.ib-matrix-help'].map(s=>[s,card.querySelector(s)?.getBoundingClientRect().height])),
          rowHeights:[...table.rows].map(r=>r.getBoundingClientRect().height),budget:parseFloat(getComputedStyle(card).maxHeight),matrixHeight:table?.getBoundingClientRect().height,
          matrixClipped:viewport && viewport.scrollHeight>viewport.clientHeight+1,
          rows:table?.tBodies[0]?.rows.length, pr:card.dataset.prVisible};
      }),visible:cards.filter(c=>{const r=c.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}).length,
      overflow:document.documentElement.scrollWidth>innerWidth,
      font:parseFloat(getComputedStyle(document.querySelector('table .ib-status-count')).fontSize)};
    });
    // Wait for fonts, the chrome observer, and the independent base measurement.
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>document.querySelector('table')?.dataset.fitPhase && document.querySelector('.ib-workspace').style.getPropertyValue('--ib-card-list-top'));
    await page.waitForTimeout(250);
    const alignment = await page.evaluate(() => {
      const rect = el => el.getBoundingClientRect();
      const center = r => ({x:r.x+r.width/2,y:r.y+r.height/2});
      const families=[...document.querySelectorAll('table .ib-family-header')].map(th=>{
        const a=center(rect(th)), b=center(rect(th.querySelector('.flavor-card')));
        return Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
      });
      const configurations=[...document.querySelectorAll('table .ib-config-label')].map(label=>{
        const tracks=[...label.children].map(rect);
        return {equal:Math.max(...tracks.map(r=>r.height))-Math.min(...tracks.map(r=>r.height)),
          badges:[...label.children].map((field,i)=>{
            const row=tracks[i], badge=rect(field.querySelector('.ib-config-value'));
            const a=center(row),b=center(badge);
            return {center:Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)),
              contained:badge.x>=row.x-.5&&badge.right<=row.right+.5&&badge.y>=row.y-.5&&badge.bottom<=row.bottom+.5};
          })};
      });
      return {families,configurations};
    });
    assert.ok(alignment.families.every(error=>error<=1.5),'every family dot/label group is centered');
    for(const config of alignment.configurations) {
      assert.ok(config.equal<=1,'three equal configuration tracks');
      assert.ok(config.badges.every(b=>b.center<=1&&b.contained),'badges centered and contained in their tracks');
    }
    const statusLayout=await page.evaluate(()=>{
      const rect=el=>el.getBoundingClientRect();
      const cells=[...document.querySelectorAll('table .ib-result-cell')];
      return cells.map(cell=>{
        const c=rect(cell),marker=cell.querySelector('.ib-status-marker'),m=marker&&rect(marker);
        return {centerError:m?Math.max(Math.abs(m.x+m.width/2-c.x-c.width/2),Math.abs(m.y+m.height/2-c.y-c.height/2)):0,
          labels:cell.querySelector('.ib-cell-comparison')?.textContent||'',
          slots:[...cell.querySelectorAll('.ib-delta-slot')].map(slot=>{
            const r=rect(slot);return {sign:slot.dataset.sign,height:r.height,top:r.top,bottom:r.bottom,rect:{left:r.left,right:r.right,cellLeft:c.left,cellRight:c.right,cellTop:c.top,cellBottom:c.bottom,markerRight:m?.right},
              contained:r.x>=(m?.right||c.left)&&r.right<=c.right+.5&&r.top>=c.top-.5&&r.bottom<=c.bottom+.5};
          })};
      });
    });
    assert.ok(statusLayout.every(c=>c.centerError<=1.5),'status/count groups stay on the true cell center');
    assert.ok(statusLayout.every(c=>!(/New|Fixed/.test(c.labels))),'no transition banners');
    assert.ok(statusLayout.some(c=>c.slots.length===2),'fixture exercises both signs');
    for(const cell of statusLayout) {
      assert.ok(cell.slots.every(s=>s.contained&&s.height<=11.5),'11px corner slots fit without touching the status: '+JSON.stringify(cell));
      if(cell.slots.length===2) assert.ok(cell.slots[0].bottom<=cell.slots[1].top+.5,'corner lines do not overlap');
    }
    const compact=await metrics();
    console.log(JSON.stringify({width,height,...compact}));
    assert.deepEqual(errors,[], 'fixture must render without errors');
    assert.ok(compact.visible>=2, `${width}x${height}: fewer than two complete cards`);
    assert.equal(compact.overflow,false,'no document horizontal overflow');
    assert.ok(compact.font>=12,'readable type');
    for(const c of compact.cards) {
      assert.ok(c.height<=c.budget+1, 'card within measured budget');
      assert.ok(c.scrollHeight<=c.height+1, 'card content not clipped');
      assert.equal(c.matrixClipped,false,'all result rows visible');
      assert.equal(c.rows,5,'fixture contains all five stages');
    }
    await page.getByRole('button',{name:'Comfortable',exact:true}).click();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.ib-release-panel')).maxHeight==='none');
    const comfortable=await metrics();
    assert.ok(comfortable.cards[0].height>compact.cards[0].height,'comfortable restores full spacing');
    await page.getByRole('button',{name:'Compact',exact:true}).click();
    await page.getByRole('button',{name:'Show Pull Requests',exact:true}).first().click();
    await page.waitForFunction(()=>document.querySelector('.ib-release-panel')?.dataset.prVisible==='true'&&getComputedStyle(document.querySelector('.ib-release-panel')).maxHeight==='none');
    const shown=await metrics();
    assert.ok(shown.cards[0].height>compact.cards[0].height,'PR shown restores original layout');
    await page.getByRole('button',{name:'Hide Pull Requests',exact:true}).first().click();
    await page.waitForTimeout(250);
    await page.evaluate(()=>scrollTo(0,0));
    assert.ok((await metrics()).visible>=2,'hiding again restores two-card layout');
    rows.push({viewport:`${width}×${height}`,cardHeight:compact.cards[0].height,cardsVisible:compact.visible});
    if (width === 1440) {
      const card = page.locator('.ib-release-panel').first();
      const trigger = card.getByRole('button', {name: 'View ASAN build history'});
      await trigger.click();
      const dialog = page.getByRole('dialog');
      const timestamps = dialog.locator('th.ib-family-header');
      assert.equal(await timestamps.count(), 5);
      assert.match(await timestamps.first().innerText(), /2026-11-09.*23:00/s);
      const compilers = dialog.getByRole('group', {name:'COMPILER', exact:true});
      await compilers.getByRole('button', {name:'gcc14', exact:true}).click();
      assert.equal(await dialog.locator('th.ib-config-header').count(), 4);
      await compilers.getByRole('button', {name:'gcc15', exact:true}).click();
      assert.ok(await dialog.getByText('Select an architecture to see its results.').isVisible());
      await dialog.getByLabel('Flavour', {exact:true}).selectOption('CMSSW_20_1_CLANG_X');
      assert.ok(await dialog.getByText('Select an architecture to see its results.').isVisible());
      await dialog.getByRole('group', {name:'COMPILER', exact:true}).getByRole('button', {name:'gcc14', exact:true}).click();
      assert.equal(await dialog.locator('th.ib-family-header').count(), 5);
      assert.equal(await dialog.locator('th.ib-config-header').count(), 5);
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'hidden'});
      await page.setViewportSize({width:390, height:844});
      await card.getByRole('button', {name:'View DEFAULT history', exact:true}).click();
      assert.ok(await dialog.locator('table').isVisible());
      assert.equal(await dialog.getByRole('group', {name:'CPU', exact:true}).getByRole('button').count(), 2);
      assert.deepEqual(errors, []);
    }
    await page.close();
  }
  assert.ok(rows.at(-1).cardHeight > rows[0].cardHeight * 1.7, 'tall screens use Comfortable spacing proportions instead of the laptop compression floor');
  console.log('LAYOUT_REPORT '+JSON.stringify(rows));
} finally {await browser.close();}
