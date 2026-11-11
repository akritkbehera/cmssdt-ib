// Real production components, deterministic data, and no external API dependency.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter} from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import '../../src/styles/tokens.css';
import '../../src/index.css';
import '../../src/dashboard.css';
import Navigation from '../../src/Components/Navigation';
import DashboardDensity from '../../src/Components/common/DashboardDensity';
import IBGroups from '../../src/Components/IBPageComponents/IBGroups';
import IBGroupFrame from '../../src/Components/IBPageComponents/IBGroupFrame';
import {STATUS_ENUM} from '../../src/config';
import {buildComparisonIndex} from '../../src/Utils/ibComparison';

const normal = 'el9_amd64_gcc14';
const flavors = ['', 'ASAN', 'CLANG', 'DBG', 'DEVEL', 'MULTIARCHS', 'NONLTO', 'ROOT642', 'ROOT6', 'UBSAN'];
const times = ['2026-11-09-2300','2026-11-09-1100','2026-11-08-2300','2026-11-08-1100','2026-11-07-2300'];
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
const comparisons = buildComparisonIndex(groups.flat());
function FixtureCard({group}) {
  const [collapsed, setCollapsed] = useState(false);
  return <IBGroupFrame IBGroup={group} releaseQue="CMSSW_20_1_X" comparisons={comparisons}
    isCollapsed={collapsed} onToggleCollapse={() => setCollapsed(value => !value)} />;
}
export const fixture = <HashRouter>
  <Navigation toLinks={[]} flaworControl={<span>Build variants</span>} archControl={<span>Architectures</span>}/>
  <DashboardDensity release="CMSSW_20_1_X">
    <div className="ib-card-list" style={{position:'relative'}}>
      {groups.map((group,i)=><div key={i}><FixtureCard group={group}/></div>)}
    </div>
  </DashboardDensity>
</HashRouter>;
const navigatorFixture = <HashRouter>
  <Navigation toLinks={[]} flaworControl={<span>Build variants</span>} archControl={<span>Architectures</span>}/>
  <DashboardDensity release="CMSSW_20_1_X">
    <IBGroups data={groups.map(comparisons => ({comparisons}))} releaseQue="CMSSW_20_1_X"
      activeArchs={{os:['el8','el9'],cpu:['amd64','aarch64'],compiler:['gcc14','gcc15']}}
      showAllPullRequests={false} />
  </DashboardDensity>
</HashRouter>;
if (typeof document !== 'undefined') createRoot(document.getElementById('root')).render(
  new URLSearchParams(location.search).has('navigator') ? navigatorFixture : fixture);
