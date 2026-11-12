import {testDeviceLabel} from '../../Utils/testDeviceLabel';
import RunningBadgeRing from './RunningBadgeRing';
import React, {useState, useMemo} from 'react';
import {Dropdown, Form} from 'react-bootstrap';
import {FaMicrochip, FaSearch} from 'react-icons/fa';
import {SiNvidia, SiAmd} from 'react-icons/si';
import {BsGpuCard} from 'react-icons/bs';
import StatusDot from './StatusDot';
import {testGroupState} from '../../Utils/buildStatus';
import {buildDropdownComparisons} from '../../Utils/dropdownComparison';
import {config} from '../../config';

function Vendor({name, type}) {
  const vendor=type==='gpu' && (/nvidia/i.test(name)?'nvidia':/amd/i.test(name)?'amd':null);
  const Icon=vendor==='nvidia'?SiNvidia:vendor==='amd'?SiAmd:type==='gpu'?BsGpuCard:FaMicrochip;
  const {model,path}=testDeviceLabel(name,type);
  return <span className="ib-dropdown-device" title={name}>
    <Icon aria-hidden="true" />
    <span className="ib-dropdown-device-label" aria-label={model+(path?'/'+path:'')}>
      <strong>{model}</strong>{path&&<span className="ib-dropdown-device-path">/{path}</span>}
    </span>
  </span>;
}

export default function TestResultDropdown({tests={}, type, kind, ib, comparisons}) {
  const [search,setSearch]=useState('');
  const [open,setOpen]=useState(false);
  const isRelval=kind==='relvals', failureKey=isRelval?'num_failed':'num_fails';
  const state=useMemo(()=>testGroupState(tests,failureKey),[tests,failureKey]);
  const context=comparisons?.get(ib);
  const deltas=useMemo(()=>buildDropdownComparisons(ib,context,type==='gpu'?'gpu_data':'other_data',kind,tests),[ib,context,type,kind,tests]);
  const records=useMemo(()=>Object.entries(tests).map(([key,item])=>({key,item,search:[key,Object.values(testDeviceLabel(key,type)).join('/')].join(' ').toLowerCase()})),[tests,type]);
  const title=type==='rntuple'?'RNTuple':isRelval?'RelVals':'Test';
  const groups=useMemo(()=>{
    const entries=records.filter(row=>row.search.includes(search.toLowerCase())).map(({key,item})=>[key,item]);
    const groups=[['Failures',[]],['Warnings',[]],['Other results',[]]];
    for(const entry of entries){
      const details=entry[1].details||{};
      const index=Number(details[failureKey])>0?0:Number(details.known_failed)>0||Number(details.num_warnings)>0||entry[1].passed==='warning'?1:2;
      groups[index][1].push(entry);
    }
    return groups;
  },[records,search,failureKey]);
  const hasBaseline=deltas.size>0;
  const hasResults=groups.some(([,items])=>items.length);
  if(!Object.keys(tests).length)return null;
  const getUrl=item=>{
    if(isRelval){
      const match=item.release_name?.match(/^(CMSSW_\d+_\d+)_((.+_|)X)_(.*)$/);
      if(!match)return undefined;
      return config.urls.newRelValsSpecific(match[1],match[4],match[2],item.arch,
        '&selected'+(type==='gpu'?'GPUs':'Others')+'='+encodeURIComponent(type==='gpu'?item.gpu:item.other)+'&selectedStatus='+(Number(item.details?.[failureKey])>0?'failed':'passed'));
    }
    if(!item.file)return undefined;
    if(item.file==='not-ready')return config.urls.scramDetailUrl+item.arch+';'+item.release_name;
    return config.urls.buildOrUnitTestUrl+item.file.split('/').slice(4,9).join('/')+'?utests/'+(type==='gpu'?'gpu':'other')+'/'+encodeURIComponent(type==='gpu'?item.gpu:item.other);
  };
  return <Dropdown className="d-inline-block me-1" autoClose="outside" show={open} onToggle={setOpen}>
    <Dropdown.Toggle variant="light" size="sm" id={type+'-'+kind+'-toggle'} className="ib-section-pill">
      <StatusDot {...state} size={22}/><span>{title}</span>
    </Dropdown.Toggle>
    <Dropdown.Menu className="ib-test-dropdown">
      <Form className="ib-dropdown-search" onSubmit={event=>event.preventDefault()}>
        <div className="d-flex align-items-center border rounded px-2"><FaSearch aria-hidden="true"/>
          <Form.Control size="sm" aria-label={'Search '+title+' results'} placeholder="Search tests..." value={search}
            onChange={event=>setSearch(event.target.value)} className="border-0 shadow-none"/>
        </div>
      </Form>
      {hasBaseline && <span className="visually-hidden">Compared with {context.previous.release_name}</span>}
      {open && groups.map(([label,items])=>items.length>0 && <React.Fragment key={label}>
        <div className="ib-dropdown-group"><span>{label}</span><span>{items.length}</span></div>
        {items.map(([key,item])=>{
          const resultState=testGroupState({item},failureKey);
          const status=resultState.status, running=resultState.running;
          const failed=Number(item.details?.[failureKey]);
          const warnings=Number(item.details?.known_failed || item.details?.num_warnings || 0);
          const numeric=status==='danger'?failed:status==='warning'?warnings:isRelval&&status==='success'?Number(item.details?.num_passed):null;
          const count=Number.isFinite(numeric)&&numeric>0 ? numeric : null;
          const delta=deltas.get(key);
          const label=(running?'Running, ':'')+(status==='danger'?'Failed':status==='warning'?'Warnings':status==='success'?'Passed':'Unknown')+(count!==null?', '+numeric:'');
          return <Dropdown.Item key={key} href={getUrl(item)} target="_blank" rel="noopener noreferrer" className="ib-dropdown-result"
            title={key+' — '+label+'. '+Object.entries(item.details||{}).filter(([name])=>['num_total','num_passed','num_failed','num_fails'].includes(name))
              .map(([name,value])=>name.replace('num_','')+': '+value).join(' · ')+(delta?' · '+delta.detail+'. Previous IB: '+delta.baseline:'')}>
            <Vendor name={key} type={type}/>
            <span className="ib-dropdown-status">
              {['danger','warning','success'].includes(status)?<span className={'ib-status-marker ib-table-result-pill ib-status-'+status+(running?' is-running':'')}
                data-result-status={status} data-running={running||undefined} role="img" aria-label={label}>
                <RunningBadgeRing />
                {count!==null?<span className="ib-status-count">{count}</span>:status==='success'
                  ?<svg className="ib-table-pass-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
                  :<span aria-hidden="true">{status==='warning'?'!':'−'}</span>}
              </span>:<StatusDot {...resultState}/>}
              <span className="ib-dropdown-deltas" title={delta?delta.detail+'. Previous IB: '+delta.baseline:undefined}>
                {delta?.metrics.map(metric=><span key={metric.key} className={'ib-dropdown-delta '+(metric.delta<0?'is-decrease':'is-increase')}
                  aria-label={Math.abs(metric.delta)+(metric.delta<0?' fewer failures':' more failures')+' than '+delta.baseline}>{metric.label}</span>)}
              </span>
            </span>

          </Dropdown.Item>;
        })}
      </React.Fragment>)}
      {!hasResults&&<Dropdown.Item disabled>No matching tests</Dropdown.Item>}
    </Dropdown.Menu>
  </Dropdown>;
}
