import assert from 'node:assert/strict';
import {chromium, firefox} from 'playwright';
const browser = await (process.env.IB_BROWSER === 'firefox' ? firefox : chromium).launch();
const targets = [[1366,620],[1440,780],[1536,700],[1920,950],[2560,1300]];
const rows=[];
try {
  for (const [width,height] of targets) {
    const page = await browser.newPage({viewport:{width,height}});
    await page.addInitScript(() => localStorage.setItem('cms_ib_density','compact'));
    await page.route(/https?:\/\/(?!localhost:5173)/, route=>route.fulfill({json:[]}));
    const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    page.on('console', message => {
      if (message.type() === 'error' && /children prop|An error occurred in/.test(message.text())) errors.push(message.text());
    });
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
    const pills = await page.locator('table .ib-table-result-pill').evaluateAll(elements => elements.map(el => {
      const count = el.querySelector('.ib-status-count'), bounds=el.getBoundingClientRect();
      const number=count?.getBoundingClientRect();
      return {state:el.dataset.resultStatus, row:el.closest('tr')?.dataset.stage, hasCount:!!count,
        hasOldDot:!!el.querySelector('.ib-state-dot'),
        fill:getComputedStyle(el).backgroundColor, ink:getComputedStyle(count || el).color,
        fits:!number || (number.left>=bounds.left-.5 && number.right<=bounds.right+.5 && number.top>=bounds.top-.5 && number.bottom<=bounds.bottom+.5)};
    }));
    assert.ok(pills.length>0 && pills.every(p=>p.fits&&!p.hasOldDot), 'solid pills contain readable counts without rim glyph chips');
    assert.ok(pills.every(p=>p.fill.startsWith('rgb(') && p.fill!=='rgb(255, 255, 255)'), 'pills render opaque coloured fills: '+JSON.stringify(pills.map(p=>({state:p.state,fill:p.fill,ink:p.ink}))));
    assert.ok(pills.filter(p=>p.state==='danger'||p.state==='success').every(p=>p.ink==='rgb(255, 255, 255)'), 'red and green pills have white foregrounds');
    assert.ok(pills.filter(p=>p.state==='warning').every(p=>p.ink!=='rgb(255, 255, 255)' && p.ink!==p.fill), 'amber digits stay dark against the solid fill');

    assert.ok(pills.filter(p=>p.state==='success'&&p.hasCount).every(p=>p.row==='relvals'), 'green counts are exclusive to RelVal');
    assert.equal(await page.locator('.ib-section-controls .ib-table-result-pill').count(),0,'section controls retain their existing icons');
    const headerBounds = await page.locator('th.ib-config-header > .ib-config-content').evaluateAll(elements =>
      elements.map(el => {
        const content = el.getBoundingClientRect(), cell = el.closest('th').getBoundingClientRect();
        return {left:content.left, right:content.right, cellLeft:cell.left, cellRight:cell.right};
      }));
    assert.ok(headerBounds.every(r => r.left >= r.cellLeft - 1 && r.right <= r.cellRight + 1),
      'configuration headers stay inside their own architecture columns');
    const railSpace = await page.evaluate(() => {
      const workspace = document.querySelector('.ib-workspace');
      const before = getComputedStyle(workspace).paddingRight;
      const rail = document.createElement('div');
      rail.className = 'ib-floating-actions';
      workspace.append(rail);
      const after = getComputedStyle(workspace).paddingRight;
      rail.remove();
      return {before, after};
    });
    assert.equal(railSpace.after, railSpace.before, 'floating actions do not reserve a blank side gutter');
    assert.equal(await page.locator('.ib-release-panel-header[role="button"]').count(), 0,
      'card headers do not nest controls inside a button role');
    const collapseButton = page.locator('.ib-release-panel').first().getByRole('button', {name:/^Collapse CMSSW/});
    await collapseButton.click();
    assert.equal(await page.locator('.ib-release-panel').first().locator('table').count(), 0);
    await page.locator('.ib-release-panel').first().getByRole('button', {name:/^Expand CMSSW/}).click();
    await page.waitForTimeout(250);
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
    const firstCard = page.locator('.ib-release-panel').first();
    await firstCard.getByRole('button', {name:/Failures only/}).click();
    assert.ok(await firstCard.locator('table').isVisible(), 'failure filtering keeps the card visible');
    assert.equal(await firstCard.locator('tbody tr').count(), 3);
    assert.equal(await firstCard.locator('tr[data-stage="addons"]').count(), 0);
    assert.ok(await page.locator('.ib-workspace').isVisible(), 'workspace survives filtering');
    await firstCard.getByRole('button', {name:/All results/}).click();
    assert.equal(await firstCard.locator('tbody tr').count(), 5);
    assert.deepEqual(errors, []);
    if (width === 1440) {
      const card = page.locator('.ib-release-panel').first();
      const trigger = card.getByRole('button', {name: 'View ASAN build history'});
      await trigger.click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('.ib-history-resize summary').click();
      await dialog.getByRole('slider', {name:'Width', exact:true}).press('End');
      for (let i=0; i<18; i++) await dialog.getByRole('slider', {name:'Width', exact:true}).press('ArrowLeft');
      assert.equal(await dialog.getByRole('slider', {name:'Height', exact:true}).count(), 0);
      await dialog.locator('.ib-history-resize summary').click();
      const savedSize = await page.evaluate(() => JSON.parse(localStorage.getItem('cms_ib_history_size')));
      assert.deepEqual(savedSize, {width:80});
      const windowSize = await dialog.locator('.modal-content').boundingBox();
      assert.ok(Math.abs(windowSize.width - width * .8) < 3);
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'hidden'});
      await trigger.click();
      const restoredSize = await dialog.locator('.modal-content').boundingBox();
      assert.ok(Math.abs(restoredSize.width - width * .8) < 3, 'history remembers its chosen width');
      assert.equal(await dialog.locator('.ib-history-date-card').count(), 0, 'desktop comparison keeps continuous history');
      assert.equal(await dialog.locator('.ib-history-date-track').count(), 0, 'desktop has no date carousel');
      const dateBand = await dialog.locator('.ib-history-day-row').boundingBox();
      assert.ok(dateBand.height <= 41, 'date header stays compact');
      const heightStyles = await dialog.locator('.modal-content').evaluate(el => ({
        height:el.style.height, resize:getComputedStyle(el).resize
      }));
      assert.equal(heightStyles.height, '');
      assert.equal(heightStyles.resize, 'horizontal');
      const timestamps = dialog.locator('th.ib-family-header');
      assert.equal(await timestamps.count(), 5);
      assert.match(await timestamps.first().innerText(), /23:00/);
      assert.equal(await dialog.locator('.ib-history-latest').count(), 1);
      const dates = await dialog.locator('.ib-history-day-heading time').evaluateAll(elements =>
        elements.map(el => ({text:el.textContent, width:el.getBoundingClientRect().width,
          cellWidth:el.closest('th').getBoundingClientRect().width})));
      assert.ok(dates.every(date => /^\d{4}-\d{2}-\d{2}$/.test(date.text) && date.width <= date.cellWidth),
        'complete history dates fit their header cells');
      const historyFailures = dialog.getByRole('button', {name:/Failures only/});
      await historyFailures.click();
      assert.equal(await dialog.locator('.ib-matrix-section').getAttribute('data-result-filter'), 'issues');
      assert.equal(await dialog.locator('tr[data-stage="addons"]').count(), 0);
      assert.equal(await dialog.locator('tr[data-stage="dupDict"]').count(), 0);
      assert.equal(await dialog.locator('tr[data-stage="utests"]').count(), 1);
      await dialog.getByRole('button', {name:/All results/}).click();
      assert.equal(await dialog.locator('.ib-matrix-section').getAttribute('data-result-filter'), 'all');
      assert.equal(await dialog.locator('tr[data-stage="addons"]').count(), 1);
      const compilers = dialog.getByRole('group', {name:'COMPILER', exact:true});
      await compilers.getByRole('button', {name:'gcc14', exact:true}).click();
      assert.equal(await dialog.locator('th.ib-config-header').count(), 4);
      await compilers.getByRole('button', {name:'gcc15', exact:true}).click();
      assert.ok(await dialog.getByText('Select an architecture to see its results.').isVisible());
      const flavourMenu = dialog.locator('details.ib-history-flavours');
      assert.equal(await flavourMenu.getAttribute('open'), null);
      await flavourMenu.locator('summary').click();
      await flavourMenu.getByRole('checkbox', {name:'CLANG', exact:true}).check();
      assert.ok(await flavourMenu.getByRole('checkbox', {name:'ASAN', exact:true}).isChecked());
      assert.ok(await dialog.getByText('Select an architecture to see its results.').isVisible());
      await dialog.getByRole('group', {name:'COMPILER', exact:true}).getByRole('button', {name:'gcc14', exact:true}).click();
      assert.equal(await dialog.locator('th.ib-family-header').count(), 10);
      assert.equal(await dialog.locator('th.ib-config-header').count(), 10);
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'hidden'});
      await page.setViewportSize({width:390, height:844});
      await card.getByRole('button', {name:'View DEFAULT history', exact:true}).click();
      assert.ok(await dialog.locator('table').first().isVisible());
      const dateCards = dialog.locator('.ib-history-date-card');
      assert.ok(await dateCards.count() > 0, 'phone comparison uses date cards');
      const firstDate = await dateCards.first().boundingBox();
      assert.ok(firstDate.width <= 390, 'phone shows one date at a readable width');
      await dialog.getByRole('button', {name:'Older →', exact:true}).click();
      await page.waitForTimeout(700);
      const dateScroll = await dialog.locator('.ib-history-date-track').evaluate(el => el.scrollLeft);
      assert.ok(dateScroll > 0, 'outer arrows navigate dates on phones');
      const innerMatrix = dateCards.nth(1).locator('.ib-table-responsive');
      await innerMatrix.evaluate(el => {el.scrollLeft = 160;});
      await page.waitForTimeout(900);
      assert.ok(Math.abs(await dialog.locator('.ib-history-date-track').evaluate(el => el.scrollLeft) - dateScroll) < 2,
        'configuration scrolling does not advance the date');
      assert.equal(await dialog.getByRole('group', {name:'CPU', exact:true}).getByRole('button').count(), 2);
      assert.deepEqual(errors, []);
    }
    await page.close();
  }
  assert.ok(rows.at(-1).cardHeight > rows[0].cardHeight * 1.7, 'tall screens use Comfortable spacing proportions instead of the laptop compression floor');
  const phone = await browser.newPage({viewport:{width:375,height:812}});
  await phone.goto('http://localhost:5173/tests/browser/index.html?navigator=1');
  await phone.locator('.ib-release-panel').first().waitFor();
  const phoneCard = phone.locator('.ib-release-panel').first();
  await phoneCard.locator('.ib-snap-slide[aria-hidden="false"] .ib-phone-column-table').waitFor();
  assert.ok(await phoneCard.locator('.ib-snap-slide[aria-hidden="false"] .ib-phone-column-table .ib-family-header').isVisible());
  assert.equal(await phoneCard.locator('.ib-snap-slide[aria-hidden="false"] .ib-phone-column-table .ib-config-field').count(), 3);
  const initialConfiguration = await phoneCard.getByLabel('Configuration', {exact:true}).inputValue();
  await phoneCard.getByRole('button', {name:'Next configuration',exact:true}).click();
  assert.notEqual(await phoneCard.getByLabel('Configuration', {exact:true}).inputValue(), initialConfiguration);
  await phoneCard.getByRole('button', {name:'Previous configuration',exact:true}).click();
  assert.equal(await phoneCard.getByLabel('Configuration', {exact:true}).inputValue(), initialConfiguration);
  await phoneCard.getByRole('button', {name:'Compare configurations',exact:true}).click();
  assert.equal(await phoneCard.locator('.ib-phone-column-navigation').count(), 0);
  const continuous = phoneCard.locator('.ib-comparison-matrix .ib-table-responsive');
  const stageBefore = await continuous.locator('tbody .name-column').first().boundingBox();
  await continuous.evaluate(el => { el.scrollLeft = 145; });
  await phone.waitForTimeout(1000);
  const stageAfter = await continuous.locator('tbody .name-column').first().boundingBox();
  assert.ok(stageAfter.width < stageBefore.width && stageAfter.width >= 67, 'scroll compresses the visible stage rail');
  assert.ok(Math.abs(stageBefore.x - stageAfter.x) <= 1, 'compressed stage rail stays pinned');
  const snapDistance = await continuous.evaluate(el => {
    const rail = el.querySelector('.name-column').getBoundingClientRect().width;
    const left = el.getBoundingClientRect().left;
    return Math.min(...[...el.querySelectorAll('th.ib-config-header')].map(th =>
      Math.abs(th.getBoundingClientRect().left - left - rail)));
  });
  assert.ok(snapDistance < 2, 'continuous scrolling settles at an architecture boundary');

  await phoneCard.getByRole('button', {name:'Single configuration',exact:true}).click();
  const railBefore = await phoneCard.locator('.ib-phone-stage-rail').boundingBox();
  const drag = await phoneCard.locator('.ib-phone-choice-viewport').boundingBox();
  await phone.mouse.move(drag.x + drag.width * .8, drag.y + drag.height / 2);
  await phone.mouse.down();
  await phone.mouse.move(drag.x + drag.width * .1, drag.y + drag.height / 2, {steps:12});
  const progress = await phoneCard.locator('.ib-matrix-section').evaluate(el => Number(el.style.getPropertyValue('--ib-swipe-progress')));
  assert.ok(progress < 0, 'drag follows the pointer before release');
  const railDuring = await phoneCard.locator('.ib-phone-stage-rail').boundingBox();
  assert.ok(Math.abs(railBefore.x - railDuring.x) < 1, 'stage labels stay anchored during drag');
  assert.ok(await phoneCard.locator('.ib-matrix-section').evaluate(el =>
    Number(el.style.getPropertyValue('--ib-swipe-activity')) > 0), 'rail responds subtly to swipe progress');
  await phone.mouse.up();
  assert.notEqual(await phoneCard.getByLabel('Configuration', {exact:true}).inputValue(), initialConfiguration);
  await phoneCard.getByRole('button', {name:'Previous configuration',exact:true}).click();
  assert.equal(await phoneCard.getByLabel('Configuration', {exact:true}).inputValue(), initialConfiguration);
  const carousel = phoneCard.locator('.ib-phone-carousel-viewport');
  await phone.waitForTimeout(450);
  const box = await carousel.boundingBox();
  const dragX = box.x + box.width / 2, dragY = box.y + 12;
  await phone.mouse.move(dragX, dragY);
  await phone.mouse.down();
  await phone.mouse.move(dragX - 20, dragY, {steps:5});
  await phone.waitForTimeout(160);
  await phone.mouse.up();
  await phone.waitForTimeout(450);
  assert.equal(await phoneCard.getByLabel('Configuration', {exact:true}).inputValue(), initialConfiguration,
    'short slow drag returns to its starting item');
  await carousel.focus();
  await phone.keyboard.press('ArrowRight');
  assert.notEqual(await phoneCard.getByLabel('Configuration', {exact:true}).inputValue(), initialConfiguration);
  await phone.keyboard.press('ArrowLeft');
  assert.equal(await phoneCard.getByLabel('Configuration', {exact:true}).inputValue(), initialConfiguration);
  await phone.waitForTimeout(450);
  await phone.mouse.move(dragX, dragY);
  await phone.mouse.wheel(600, 0);
  for (let i=0; i<5; i++) { await phone.waitForTimeout(30); await phone.mouse.wheel(40, 0); }
  await phone.waitForTimeout(500);
  const wheelValue = await phoneCard.getByLabel('Configuration', {exact:true}).inputValue();
  const secondValue = await phoneCard.getByLabel('Configuration', {exact:true}).locator('option').nth(1).getAttribute('value');
  assert.equal(wheelValue, secondValue, 'trackpad momentum advances only one configuration');
  await phoneCard.getByRole('button', {name:'Previous configuration',exact:true}).click();
  await phone.locator('.navbar-toggler').click();
  await phone.locator('.navbar-collapse.show').waitFor();
  await phone.keyboard.press('Escape');
  await phone.locator('.navbar-collapse.show').waitFor({state:'detached'});
  assert.equal(await phone.locator('.ib-page-actions:visible').count(), 0);
  await phone.getByRole('button',{name:'Page controls',exact:true}).click();
  await phone.getByRole('button',{name:'Show releases',exact:true}).click();
  await phone.getByRole('dialog',{name:'Jump to release',exact:true}).waitFor();
  await phone.keyboard.press('Escape');
  await phone.getByRole('dialog',{name:'Jump to release',exact:true}).waitFor({state:'hidden'});
  await phone.close();
  if (process.env.IB_BROWSER !== 'firefox') {
    const touch = await browser.newPage({viewport:{width:390,height:844}, hasTouch:true, isMobile:true});
    await touch.goto('http://localhost:5173/tests/browser/index.html?navigator=1');
    const card = touch.locator('.ib-release-panel').first();
    const choice = card.locator('.ib-phone-choice-viewport');
    await choice.waitFor();
    await touch.waitForTimeout(300);
    const initial = await card.getByLabel('Configuration', {exact:true}).inputValue();
    await choice.scrollIntoViewIfNeeded();
    const bounds = await choice.boundingBox();
    const session = await touch.context().newCDPSession(touch);
    const y = bounds.y + bounds.height / 2, x = bounds.x + bounds.width * .9;
    await session.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x,y,id:1}]});
    for (const fraction of [.2,.4,.65]) {
      await touch.waitForTimeout(40);
      await session.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:x-bounds.width*fraction,y,id:1}]});
    }
    const moving = await card.locator('.ib-matrix-section').evaluate(el => Number(el.style.getPropertyValue('--ib-swipe-progress')));
    assert.ok(moving < -.2, 'real touch keeps dragging after implicit capture transfers');
    assert.equal(await card.getByLabel('Configuration', {exact:true}).inputValue(), initial, 'touch does not commit before release');
    await session.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
    await touch.waitForTimeout(450);
    assert.notEqual(await card.getByLabel('Configuration', {exact:true}).inputValue(), initial, 'real touch release advances');
    await card.getByRole('button', {name:'Previous configuration',exact:true}).click();
    await touch.waitForTimeout(450);
    assert.equal(await card.getByLabel('Configuration', {exact:true}).inputValue(), initial, 'arrow navigation stays synchronized after touch');
    await touch.goto('http://localhost:5173/tests/browser/index.html');
    await touch.locator('.ib-release-panel').first().getByRole('button', {name:'View DEFAULT history',exact:true}).tap();
    const historyDialog = touch.getByRole('dialog');
    const datesTrack = historyDialog.locator('.ib-history-date-track');
    await historyDialog.getByRole('button', {name:'Older →',exact:true}).tap();
    await touch.waitForTimeout(500);
    assert.ok(await datesTrack.evaluate(el=>el.scrollLeft)>0, 'touch tap advances history date');
    await historyDialog.getByRole('button', {name:'← Newer',exact:true}).tap();
    await touch.waitForTimeout(500);
    assert.ok(await datesTrack.evaluate(el=>el.scrollLeft)<2, 'touch tap restores newest date');
    const handle = historyDialog.locator('.ib-history-date-handle').first();
    await handle.scrollIntoViewIfNeeded();
    const hb = await handle.boundingBox(), hx=hb.x+hb.width*.9, hy=hb.y+hb.height/2;
    await session.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:hx,y:hy,id:2}]});
    for(const fraction of [.15,.35,.6,.8]){
      await touch.waitForTimeout(35);
      await session.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:hx-hb.width*fraction,y:hy,id:2}]});
    }
    assert.ok(await datesTrack.evaluate(el=>el.scrollLeft)>hb.width*.3, 'history moves with the finger before release');
    await session.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    await touch.waitForTimeout(500);
    assert.ok(await datesTrack.evaluate(el=>el.scrollLeft)>hb.width*.8, 'touch swipe settles at next date');
    await touch.close();
  }

  for (const width of [390,1440]) {
    const menuPage=await browser.newPage({viewport:{width,height:900}});
    await menuPage.goto('http://localhost:5173/tests/browser/index.html?dropdowns=1');
    const latestCard=menuPage.locator('.ib-release-panel').first();
    for (const [id,delta] of [['gpu-relvals-toggle','−2'],['gpu-qa-toggle','+2'],['rntuple-relvals-toggle','−2']]) {
      await latestCard.locator('#'+id).click();
      const menu=latestCard.locator('.ib-test-dropdown.show');
      await menu.waitFor();
      assert.ok((await menu.innerText()).includes(delta),'exact baseline delta appears in '+id);
      const marker=menu.locator('.ib-table-result-pill').first();
      assert.ok(await marker.isVisible());
      const fill=await marker.evaluate(el=>getComputedStyle(el).backgroundColor);
      assert.ok(fill.startsWith('rgb(') && fill!=='rgb(255, 255, 255)','dropdown count badge is filled');
      const bounds=await menu.boundingBox();
      assert.ok(bounds.x>=-1 && bounds.x+bounds.width<=width+1,'dropdown stays within viewport');
      if(id==='gpu-qa-toggle') assert.equal(await marker.locator('.ib-status-count').innerText(),'3');
      if(id==='rntuple-relvals-toggle') assert.equal(await marker.locator('.ib-status-count').innerText(),'12');
      await menu.getByRole('textbox').fill('not-a-device');
      assert.ok(await menu.getByText('No matching tests').isVisible());
      await latestCard.locator('#'+id).click();
    }
    await menuPage.close();
  }

  console.log('LAYOUT_REPORT '+JSON.stringify(rows));
} finally {await browser.close();}
