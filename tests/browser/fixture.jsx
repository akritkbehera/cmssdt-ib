// Real production components, deterministic data, and no external API dependency.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter} from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import '../../src/styles/tokens.css';
import '../../src/index.css';
import '../../src/dashboard.css';
import OverflowLabel from '../../src/Components/common/OverflowLabel';
import Navigation from '../../src/Components/Navigation';
import DashboardDensity from '../../src/Components/common/DashboardDensity';
import IBGroups from '../../src/Components/IBPageComponents/IBGroups';
import IBGroupFrame from '../../src/Components/IBPageComponents/IBGroupFrame';
import {STATUS_ENUM} from '../../src/config';
import {buildComparisonIndex} from '../../src/Utils/ibComparison';

const normal = 'el9_amd64_gcc14';
const flavors = ['', 'ASAN', 'CLANG', 'DBG', 'DEVEL', 'MULTIARCHS', 'NONLTO', 'ROOT642', 'ROOT6', 'UBSAN'];
const performanceMode=typeof location!=='undefined' && new URLSearchParams(location.search).has('performance');
const times = performanceMode ? Array.from({length:20},(_,i)=>'2026-11-'+String(30-i).padStart(2,'0')+'-2300') : ['2026-11-09-2300','2026-11-09-1100','2026-11-08-2300','2026-11-08-1100','2026-11-07-2300'];
export const groups = times.map((time, group) => flavors.map((flavor, i) => {
  const queue = `CMSSW_20_1_${flavor ? flavor+'_' : ''}X`;
  const archs = i===0 ? ['el8_amd64_gcc14','el9_aarch64_gcc14',normal] : i===1 ? [normal,'el9_amd64_gcc15'] : i===8 ? ['el9_aarch64_gcc14',normal] : [normal];
  const stage = (passed, count) => archs.map(arch => ({arch,passed,done:true,file:'fixture.log',details:{num_failed:passed?0:count, num_passed:passed?12:0}}));
  return {isIB:true,next_ib:false, release_queue:queue,release_name:`${queue}_${time}`,ib_date:time,
    compared_tags:'previous-->current',hlt_tests:STATUS_ENUM.passed,class_versions:STATUS_ENUM.passed,vtune:STATUS_ENUM.passed,crab_tests:STATUS_ENUM.passed,
    tests_archs:archs, builds:stage(i%3===0,8),utests:stage(false,group+1),relvals:stage(false,group+3),
    addons:stage(true,0),dupDict:stage(true,0),merged_prs:[],
    hlt:stage(true,0),static_checks:stage(true,0), runtests:stage(true,0),crab:stage(true,0),fwlite:stage(true,0),rntuple:stage(true,0)};
}));
if(new URLSearchParams(location.search).has('archtooltips')){
  groups.forEach(group=>group.forEach(ib=>{
    ib.compared_tags='previous-->'+ib.release_name;
    ib.cmsdistTags=Object.fromEntries(ib.tests_archs.map((arch,index)=>[arch,
      index===1?'IB/previous_'+('long_tag_'.repeat(30))+'/'+arch:'IB/'+ib.release_name+'/'+arch]));
  }));
}
// Exercise empty, decreasing, increasing and mixed gutters, plus a running cell.
groups.forEach((group, time) => group.forEach((ib, flavor) => {
  const scenario = flavor % 4;
  ib.relvals = ib.tests_archs.map(arch => ({arch, passed:false, done:!(time===0 && flavor===6), file:'fixture.log',
    details:{num_failed:scenario===0 ? 3 : scenario===1 ? (time===0 ? 3 : 12) : scenario===2 ? (time===0 ? 12 : 3) : (time===0 ? 3 : 12),
      num_passed:scenario===3 && time===0 ? 35 : 0}}));
}));
// An advertised configuration with no stage results must not occupy a history column.
for (const stage of ['builds', 'utests', 'relvals', 'addons', 'dupDict']) {
  groups.at(-1)[1][stage] = groups.at(-1)[1][stage].filter(result => result.arch !== 'el9_amd64_gcc15');
}

if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('dropdowns')) {
  groups.forEach((group,time)=>{
    const ib=group[0];
    const result=(field,name,count,kind)=>({arch:normal,[field]:name,release_name:ib.release_name,file:'fixture.log',done:true,passed:count?false:true,
      details:kind==='qa'?{num_fails:count,num_passed:12-count,num_total:12}:{num_failed:count,num_passed:12-count,num_total:12}});
    ib.gpu_data={relvals:{'NVIDIA T4':result('gpu','nvidia-T4',time===0?2:4,'relvals')},
      qa:{'AMD MI250':result('gpu','amd-MI250',time===0?3:1,'qa')}};
    ib.other_data={relvals:{'rntuple/cpu':result('other','rntuple/cpu',time===0?0:2,'relvals')}};
  });
}
if(performanceMode){
  groups.forEach(group=>{
    const ib=group[0];
    ib.gpu_data={relvals:Object.fromEntries(Array.from({length:80},(_,i)=>['NVIDIA_GPU'+i+'/el9_amd64_gcc14',{
      arch:normal,gpu:'gpu'+i,release_name:ib.release_name,file:'fixture.log',done:true,passed:false,details:{num_failed:2,num_passed:10}
    }]))};
  });
}
const comparisons = buildComparisonIndex(groups.flat());
function FixtureCard({group}) {
  const [collapsed, setCollapsed] = useState(false);
  return <IBGroupFrame IBGroup={group} releaseQue="CMSSW_20_1_X" comparisons={comparisons}
    isCollapsed={collapsed} onToggleCollapse={() => setCollapsed(value => !value)} />;
}
function ReviewLabels() {
  const [width,setWidth]=useState(30);
  return <div style={{fontSize:12}}>
    <div data-testid="short-label" style={{width:180}}><OverflowLabel text="NONLTO"/></div>
    <div data-testid="resize-label" style={{width}}><OverflowLabel text="NONLTO"/></div>
    <button onClick={()=>setWidth(60)}>Give label room</button>
    <div data-testid="long-label" style={{width:60}}><OverflowLabel text="MULTIARCHSV4"/></div>
  </div>;
}
export const fixture = <HashRouter>
  <Navigation toLinks={[]} flaworControl={<span>Build variants</span>} archControl={<span>Architectures</span>}/>
  <DashboardDensity release="CMSSW_20_1_X">
    <div className="ib-card-list" style={{position:'relative'}}>
      {new URLSearchParams(location.search).has('review') && <>
        <FixtureCard group={[{isIB:false,next_ib:true,release_queue:'CMSSW_20_1_X',release_name:'nextIB',compared_tags:'previous-->CMSSW_20_1_X',merged_prs:[]}]}/>
        <ReviewLabels/>
      </>}
      {groups.map((group,i)=><div key={i}><FixtureCard group={group}/></div>)}
    </div>
  </DashboardDensity>
</HashRouter>;
function NavigatorFixture() {
  const [showPRs,setShowPRs]=useState(false);
  return <HashRouter>
  <Navigation showAllPullRequests={showPRs} onToggleAllPullRequests={()=>setShowPRs(value=>!value)} toLinks={[]} flaworControl={<span>Build variants</span>} archControl={<span>Architectures</span>}/>
  <DashboardDensity release="CMSSW_20_1_X">
    <IBGroups data={groups.map(comparisons => ({comparisons}))} releaseQue="CMSSW_20_1_X"
      activeArchs={{os:['el8','el9'],cpu:['amd64','aarch64'],compiler:['gcc14','gcc15']}}
      showAllPullRequests={showPRs} />
  </DashboardDensity>
</HashRouter>;
}
const navigatorFixture=<NavigatorFixture/>;
if (typeof document !== 'undefined') {
  const view=new URLSearchParams(location.search).has('navigator') ? navigatorFixture : fixture;
  window.__ibProfile=[];
  createRoot(document.getElementById('root')).render(performanceMode ?
    <React.Profiler id="dashboard" onRender={(id,phase,duration)=>window.__ibProfile.push({phase,duration})}>{view}</React.Profiler> : view);
}
