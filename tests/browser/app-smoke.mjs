// Exercise the built app with real providers, request batching and lazy routes.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:900}});
const normal='el9_amd64_gcc14',queue='CMSSW_20_1_X',asan='CMSSW_20_1_ASAN_X',requests=[];
const structure={all_prefixes:[queue],all_release_queues:[queue,asan],default_release:queue,[queue]:[queue,asan]};
const summary={prod_archs:{[queue]:normal},[queue]:{[normal]:{}},[asan]:{[normal]:{}}};
const record=q=>({isIB:true,next_ib:false,release_queue:q,release_name:q+'_2026-11-09-2300',ib_date:'2026-11-09-2300',tests_archs:[normal],merged_prs:[],
  builds:[{arch:normal,passed:'warning',done:true,details:{compWarning:4}}],
  utests:[{arch:normal,passed:false,done:true,details:{num_failed:1,num_passed:12}}],
  relvals:[{arch:normal,passed:false,done:true,details:{num_failed:3,num_passed:12}}]});
let releaseSecond;
const second=new Promise(resolve=>releaseSecond=resolve),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),name=url.pathname.split('/').at(-1);
  if(url.hostname==='localhost' && !name.endsWith('.json'))return route.continue();
  if(name==='structure.json'){requests.push(name);return route.fulfill({json:structure});}
  if(name==='LatestIBsSummary.json'){requests.push(name);return route.fulfill({json:summary});}
  if(name===queue+'.json'){requests.push(name);return route.fulfill({json:{release_name:queue,comparisons:[record(queue)]}});}
  if(name===asan+'.json'){requests.push(name);await second;return route.fulfill({json:{release_name:asan,comparisons:[record(asan)]}});}
  if(name==='RelvalsAvailableResults.json'||name==='exitcodes.json'){requests.push(name);return route.fulfill({json:{}});}
  return route.fulfill({body:'',contentType:'text/plain'});
});
try{
  await page.goto('http://localhost:5174/#/ib/'+queue);
  await page.locator('.ib-release-panel table').first().waitFor();
  assert.ok(await page.locator('.ib-progressive-loading').isVisible(),'first file renders while second request is pending');
  assert.equal(requests.filter(name=>name==='structure.json').length,1,'structure loads once');
  assert.equal(requests.includes('RelvalsAvailableResults.json'),false,'IB route does not load RelVal-only data');
  assert.equal(requests.includes('exitcodes.json'),false,'IB route does not initialize RelVal-only providers');
  releaseSecond();
  await page.locator('th.ib-family-header').filter({hasText:'ASAN'}).waitFor();
  await page.locator('.ib-progressive-loading').waitFor({state:'hidden'});
  await page.evaluate(()=>{location.hash='/relVal/CMSSW_20_1/2026-11-09-2300';});
  await page.getByRole('heading',{name:'No data available',exact:true}).waitFor();
  assert.equal(requests.filter(name=>name==='RelvalsAvailableResults.json').length,1,'RelVal provider initializes on demand once');
  assert.deepEqual(errors,[]);
  console.log('APP_SMOKE_PASS '+JSON.stringify(requests));
}finally{releaseSecond();await browser.close();}
