import { flavourHistory, historyFlavours, selectHistoryBuilds } from '../../Utils/flavourHistory';
import { ibIdentity } from '../../Utils/ibComparison';
import TogglesShowArchs from '../TogglesShowArchs';
import useHistorySize from '../common/useHistorySize';
import OverflowLabel from '../common/OverflowLabel';
import ResultFilter from '../common/ResultFilter';
import ResultDeltaGutter from '../common/ResultDeltaGutter';
import MatrixHelp from '../common/MatrixHelp';
import useMatrixFit from "../common/useMatrixFit";
import { stages } from "../../Utils/resultDelta";
import { compareCell, comparableCellResults } from "../../Utils/ibComparison";
import { summarizeMatrix } from "../../Utils/matrixSummary";
import ArchitectureHeader from "../common/ArchitectureHeader";
import StatusDot from "../common/StatusDot";
import ResultDetails from "../common/ResultDetails";
import ResultChangePreview from "../common/ResultChangePreview";
import { configurationBuildState, familyBuildState, matchesResultFilter } from "../../Utils/buildStatus";
import { tableTheme as THEME } from "../../styles/theme";
import React, { useMemo, useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { Modal, OverlayTrigger, Table, Tooltip } from "react-bootstrap";
import {
  checkLabelType,
  extractInfoFromArchs,
  getAllActiveArchitecturesFromIBGroupByFlavor,
  getDisplayName,
  getInfoFromRelease,
  valueInTheList
} from '../../Utils/processing';
import _ from 'underscore';
import { config, showLabelConfig } from '../../config';
import { useShowArch } from "../../context/ShowArchContext";
import {
  FaCheckCircle,
  FaExclamationTriangle,
  FaQuestionCircle,
  FaInfoCircle,
  FaCheck,
  FaTimes,
  FaPlay,
  FaCodeBranch,
  FaTag,
  FaWrench,
  FaTools,
  FaVial,
  FaPlus,
  FaClipboardList,
  FaLayerGroup,
  FaCubes,
  FaHistory,
  FaCopy
} from 'react-icons/fa';

const { tooltipDelayInMs, urls } = config;



const FLAVOR_CARDS = Array.from({ length: 6 }).map(() => ({
  bg: 'var(--ui-surface-muted)',
  text: 'var(--ui-text-secondary)',
  border: '#334155',
  shadow: 'none'
}));

const statusStyles = {
  success: {
    sphereIcon: <FaCheck size={12} />,
    description: 'All tests passed successfully',
  },
  danger: {
    sphereIcon: <FaTimes size={12} />,
    description: 'Build or tests failed',
  },
  warning: {
    sphereIcon: <FaExclamationTriangle size={12} />,
    description: 'Warnings detected',
  },
  secondary: {
    sphereIcon: <FaQuestionCircle size={12} />,
    description: 'Status unknown',
  },
  info: {
    sphereIcon: <FaPlay size={12} />,
    description: 'Tests in progress',
  }
};

const rowLabelConfig = {
  builds: { text: 'Build', icon: <FaCubes size={12} /> },
  utests: { text: 'Unit tests', icon: <FaVial size={12} /> },
  relvals: { text: 'RelVal', icon: <FaLayerGroup size={12} /> },
  addons: { text: 'AddOn', icon: <FaPlus size={12} /> },
  dupDict: { text: 'Q/A duplicates', icon: <FaClipboardList size={12} /> }
};

const checkIfItIsAPatch = (current_tag, architecture, tagName) => {
  const intendedTagName1 = `IB/${current_tag}/${architecture}`;
  const intendedTagName2 = `ERR/${current_tag}/${architecture}`;
  return tagName !== intendedTagName1 && tagName !== intendedTagName2;
};

const removeKeysFromDetails = (details, keysToRemove = []) => {
  if (!details || typeof details !== 'object') return details;
  const filtered = { ...details };
  keysToRemove.forEach((key) => {
    delete filtered[key];
  });
  return filtered;
};

const formatFlavorLabel = (value) => getDisplayName(value).replace(/_X$/, '');

function makeSafeId(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function renderStickyRowLabel(typeKey, color = THEME.text.primary) {
  const cfg = rowLabelConfig[typeKey];
  if (!cfg) return null;

  return (
    <>
      <span className="type-label-desktop">{cfg.text}</span>
      <span className="type-label-mobile" style={{ color }} title={cfg.text}>
        {cfg.icon}
      </span>
    </>
  );
}

const ArchTooltip = ({ cmsdistTag, isPatch, baseTag }) => (
  <div className="text-start p-3" style={{ minWidth: '280px' }}>
    <div className="d-flex align-items-center border-bottom pb-2 mb-2">
      <FaCodeBranch className="text-primary me-2" size={16} />
      <span className="fw-semibold">CMSDist Tag Information</span>
    </div>

    <div className="mb-3">
      <div className="d-flex align-items-center mb-1">
        <FaTag className="text-secondary me-2" size={12} />
        <span className="text-muted small fw-semibold">Current Tag:</span>
      </div>
      <code className="bg-light p-2 rounded d-block small" style={{ fontFamily: 'monospace' }}>
        {cmsdistTag || 'N/A'}
      </code>
    </div>

    {isPatch ? (
      <div className="mb-2">
        <div className="d-flex align-items-center mb-1">
          <FaExclamationTriangle className="text-warning me-2" size={12} />
          <span className="text-muted small fw-semibold">Patch Build:</span>
        </div>
        <div className="bg-warning bg-opacity-10 p-2 rounded small">
          Using same cmsdist tag as <code className="bg-light px-1 rounded">{baseTag}</code>
        </div>
      </div>
    ) : (
      <div className="mb-2">
        <div className="d-flex align-items-center mb-1">
          <FaCheckCircle className="text-success me-2" size={12} />
          <span className="text-muted small fw-semibold">Full Build:</span>
        </div>
        <div className="bg-success bg-opacity-10 p-2 rounded small">
          Using a dedicated cmsdist tag for this build
        </div>
      </div>
    )}
  </div>
);

const StatusTooltip = ({ status, value, details, type, running = false }) => {
  const style = statusStyles[status] || statusStyles.secondary;

  const formatValue = (val) => {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'object') {
      try {
        return JSON.stringify(val);
      } catch {
        return '[Complex Data]';
      }
    }
    return String(val);
  };

  return (
    <div className="text-start p-3" style={{ minWidth: '250px' }}>
      <div className="d-flex align-items-center border-bottom pb-2 mb-2">
        <StatusDot status={status} running={running} size={22} />
        <span className="fw-semibold ms-2">{type || 'Status'} Information{running ? ' · running' : ''}</span>
      </div>

      <div className="mb-2">
        <div className="d-flex align-items-center mb-1">
          <FaInfoCircle className="text-info me-2" size={12} />
          <span className="text-muted small fw-semibold">Current Status:</span>
        </div>
        <div className="d-flex align-items-center mt-1">
          <StatusDot status={status} running={running} size={22} />
          <span className="small">{style.description}</span>
        </div>
      </div>

      {details && Object.keys(details).length > 0 && (
        <div className="mb-2">
          <div className="d-flex align-items-center mb-1">
            <span className="text-muted small fw-semibold">Details:</span>
          </div>
          <div className="bg-light p-2 rounded small">
            {Object.entries(details).map(([key, val]) => {
              if (val && typeof val === 'object' && Object.keys(val).length === 0) return null;
              return (
                <div key={key} className="d-flex justify-content-between mb-1">
                  <span className="text-muted">{key}:</span>
                  <span className="fw-semibold ms-2" style={{ wordBreak: 'break-word', maxWidth: '150px' }}>
                    {formatValue(val)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

function renderTooltip(cellContent, tooltipContent, tooltipId = 'tooltip-status') {
  return <ResultDetails className="ib-status-details" overlay={tooltipContent} tooltipId={tooltipId}>{cellContent}</ResultDetails>;
}

function baseRenderCell(cellInfo, key) {
  return (
    <td key={key} className="align-middle p-1" style={{ textAlign: 'center', verticalAlign: 'middle' }}>
      {cellInfo}
    </td>
  );
}

function renderStatusMarker({ status = "secondary", value, icon, link, tooltipContent, details, type, tooltipId, running = false } = {}) {
  const displayValue = value !== undefined ? value : '';

  if (displayValue === 0 || displayValue === '') return null;

  const hasNumericValue =
    typeof displayValue === 'number' ||
    (typeof displayValue === 'string' && /\d/.test(displayValue));

  const metric = type?.toLowerCase().includes('build') ? (status === 'warning' ? 'compiler warnings' : 'build errors') : type === 'Q/A' ? 'duplicate-check outcome' : 'test results';
  const sphereContent = (
    <span className={`ib-status-marker ib-status-${status} ${status === "success" ? "is-pass" : status === "danger" ? "is-fail" : ""} ${running ? "is-running" : ""}`}
      role="img" data-result-status={status} data-running={running || undefined} data-result-count={hasNumericValue ? Number.parseFloat(displayValue) : undefined} title={`${displayValue} ${metric}`} aria-label={`${running ? "Running — partial result. " : ""}${type || 'Test'}: ${statusStyles[status]?.description || 'Unknown'}${hasNumericValue ? ` (${displayValue} ${metric})` : ''}`}>
      <StatusDot status={status} running={running} solid={!running} />
      {hasNumericValue && status !== 'success' && <span className="ib-status-count">{displayValue}</span>}
    </span>
  );

  const enhancedTooltip = tooltipContent || (
    <StatusTooltip
      status={status}
      running={running}
      value={displayValue}
      details={details ? { ...details } : {}}
      type={type}
    />
  );

  const wrappedContent = link ? (
    <a href={link} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
      {sphereContent}
    </a>
  ) : sphereContent;

  return renderTooltip(
    wrappedContent,
    enhancedTooltip,
    tooltipId || `tooltip-${makeSafeId(type)}-${makeSafeId(displayValue)}`
  );
}

const getBuildOrUnitUrl = ({ file, arch, ibName, urlParameter = '' }) => {
  if (!file) return undefined;
  if (file === 'not-ready') return urls.scramDetailUrl + arch + ";" + ibName;
  const linkParts = file.split('/').slice(4, 9);
  return urls.buildOrUnitTestUrl + linkParts.join('/') + urlParameter;
};

const getRelValUrl = ({ file, arch, ibName, selectedStatus }) => {
  if (!file) return undefined;
  if (file === 'not-ready') return urls.relVals + arch + ';' + ibName;
  const [, que, flavor, date] = getInfoFromRelease(ibName);
  return urls.newRelValsSpecific(que, date, flavor, arch, selectedStatus);
};

const getOtherTestUrl = ({ file }) => {
  const linkParts = file.split('/').slice(4, 9);
  return urls.showAddOnLogsUrls + linkParts.join('/') + '/addOnTests/';
};

const statusIcons = {
  success: <FaCheck className="me-1" size={10} />,
  danger: <FaTimes className="me-1" size={10} />,
  warning: null,
  secondary: <FaQuestionCircle className="me-1" size={10} />,
  info: <FaPlay className="me-1" size={10} />
};

const copyText = (text) => {
  if (!text) return;

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textArea);
  }
};

const ComparisonTable = ({ data = [], comparisons = new Map(), releaseQue, resultFilter = 'all', onCountsChange, historyArchs, historyLatest = [] }) => {
  const historyWindow = useHistorySize();
  const [history, setHistory] = useState(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('all');
  const [historyCounts, setHistoryCounts] = useState(null);
  function openHistory(position) {
    setShowAllHistory(false);
    setHistoryFilter('all');
    setHistoryCounts(null);
    const builds = flavourHistory(data[position], comparisons.keys());
    if (builds.length) setHistory({ anchor: data[position], builds, filters: extractInfoFromArchs(archsByIb[position].archs) });
  }
  const flavourOptions = useMemo(() => history ? historyFlavours(history.anchor, comparisons.keys()) : [],
    [history?.anchor, comparisons]);
  const availableHistoryArchs = useMemo(() => history
    ? [...new Set(flavourOptions.filter(option => history.builds.some(ib => ib.release_queue === option.release_queue))
      .flatMap(option => flavourHistory(option, comparisons.keys())).flatMap(ib => ib.tests_archs || []))].sort() : [], [history?.builds, flavourOptions, comparisons]);
  const historyOptions = useMemo(() => extractInfoFromArchs(availableHistoryArchs), [availableHistoryArchs]);
  const selectedHistoryArchs = useMemo(() => availableHistoryArchs.filter(arch => {
    const [os, cpu, compiler] = arch.split('_');
    return history.filters.os.includes(os) && history.filters.cpu.includes(cpu) &&
      history.filters.compiler.includes(compiler);
  }), [availableHistoryArchs, history?.filters]);
  const visibleHistoryBuilds = history ? history.builds.filter(ib => stages.some(stage =>
    (ib[stage] || []).some(result => selectedHistoryArchs.includes(result.arch)))) : [];
  const hasHistoryResults = visibleHistoryBuilds.length > 0;
  const missingFlavours = history ? [...new Set(history.builds.map(ib => ib.release_queue))]
    .filter(queue => !visibleHistoryBuilds.some(ib => ib.release_queue === queue)) : [];
  const [configuration, setConfiguration] = useState('');
  const [compareOnPhone, setCompareOnPhone] = useState(false);
  const [inView, setInView] = useState(true);
  const sectionRef = useRef(null);
  const [copiedText, setCopiedText] = useState(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const tableContainer = useRef(null);
  const { getActiveArchsForQue = () => [], getColorsSchemeForQue = () => ({}) } = useShowArch();

  const handleCopy = (e, text) => {
    e.preventDefault();
    e.stopPropagation();

    copyText(text);
    setCopiedText(text);

    setTimeout(() => {
      setCopiedText(null);
    }, 1500);
  };

  const activeArchs = getActiveArchsForQue(releaseQue);
  const configurationColors = getColorsSchemeForQue(releaseQue);

  const { que, date } = useMemo(() => {
    if (data[0]) {
      const [, q, , d] = getInfoFromRelease(data[0].release_name);
      return { que: q, date: d };
    }
    return {};
  }, [data]);

  const archsByIb = useMemo(
    () => {
      const items = getAllActiveArchitecturesFromIBGroupByFlavor(data, activeArchs);
      return historyArchs ? items.map((item, index) => ({ ...item,
        archs: historyArchs.filter(arch => stages.some(stage =>
          (data[index][stage] || []).some(result => result.arch === arch)))
      })) : items;
    },
    [data, activeArchs, historyArchs]
  );

  const historyDays = [];
  const historyBoundaries = new Map();
  if (historyArchs) {
    let previousStamp;
    archsByIb.forEach((item, position) => {
      if (!item.archs.length) return;
      const stamp = data[position].release_name.slice(item.flavor.length + 1);
      const day = stamp.slice(0, 10);
      historyBoundaries.set(position, day !== previousStamp?.slice(0, 10) ? 'ib-history-day-start'
        : stamp !== previousStamp ? 'ib-history-time-start' : '');
      if (historyDays.at(-1)?.day === day) historyDays.at(-1).columns += item.archs.length;
      else historyDays.push({ day, columns: item.archs.length });
      previousStamp = stamp;
    });
  }
  const configurations = archsByIb.flatMap((item, position) => (item.archs || []).map(arch => ({
    key: JSON.stringify([item.name, arch]), position, arch, flavor: item.flavor
  })));
  const selected = configurations.find(item => item.key === configuration) || configurations[0];
  const selectedIndex = configurations.indexOf(selected);
  const phoneTouch = useRef(null);
  const [isPhone, setIsPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767.98px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767.98px)');
    const update = () => setIsPhone(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const selectNeighbour = offset => {
    const next = configurations[selectedIndex + offset];
    if (next) setConfiguration(next.key);
  };
  useEffect(() => {
    const element = sectionRef.current?.closest('.ib-release-panel') || sectionRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    let visible = true;
    const update = () => {
      const active = visible && !document.hidden;
      setInView(active);
      element.style.setProperty('--ib-motion-state', active ? 'running' : 'paused');
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
    observer.observe(element);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); element.style.removeProperty('--ib-motion-state'); };
  }, []);

  const matrixLayout = useMemo(() => [archsByIb, resultFilter], [archsByIb, resultFilter]);
  useMatrixFit(tableContainer, configurations.length, matrixLayout, setHasOverflow);

  const mobileCells = [];
  function renderCell(cellInfo, key) {
    const [stage, position] = key.split('-');
    const ib = data[Number(position)];
    const arch = (ib?.tests_archs || []).filter(value => key === `${stage}-${position}-${value}` || key.startsWith(`${stage}-${position}-${value}-`)).sort((a, b) => b.length - a.length)[0];
    const candidates = ib?.[stage]?.filter(item => item.arch === arch) || [];
    const current = candidates.length === 1 ? candidates[0] : null;
    const context = comparisons.get(ib);
    const delta = stages.includes(stage) ? compareCell(ib, context, stage, arch) : null;
    const running = current?.done === false;
    const pair = ['relvals', 'utests'].includes(stage) ? comparableCellResults(ib, context, stage, arch) : null;
    const preview = pair ? <ResultChangePreview stage={stage} arch={arch} ib={ib} previousIb={context.previous}
      current={pair.current} previous={pair.previous} /> : null;
    let hasMarker = false;
    let resultStatus = 'secondary';
    const decorate = node => {
      if (Array.isArray(node)) return React.Children.map(node, decorate);
      if (!React.isValidElement(node)) return node;
      if (node.type === StatusTooltip) return <>{React.cloneElement(node, { running })}{preview}</>;
      if (node.type === StatusDot) return React.cloneElement(node, { running, solid: !running });
      if (node.props['data-result-status']) {
        hasMarker = true;
        const status = node.props['data-result-status'];
        resultStatus = status;
        const label = status === 'success' ? 'Running — passing so far' : status === 'danger' ? 'Running — failures detected' : 'Running — partial result';
        return React.cloneElement(node, { className: `${node.props.className} ${running ? 'is-running' : ''}`, 'data-running': running || undefined, 'aria-label': `${running ? label : current?.done === true ? "Completed" : "Reported"}. ${node.props['aria-label']}` }, decorate(node.props.children));
      }
      const extra = node.props.overlay ? { overlay: decorate(node.props.overlay) } : {};
      return React.cloneElement(node, extra, decorate(node.props.children));
    };
    let content = decorate(cellInfo);
    if (running && !hasMarker) content = renderStatusMarker({ status: 'secondary', value: ' ', running: true, type: stage });
    const boundary = arch === archsByIb[Number(position)]?.archs[0];
    const cell = <td key={key} className={`align-middle ib-result-cell ${boundary ? `ib-group-start ${historyBoundaries.get(Number(position)) || ''}` : ''}`} data-muted={!matchesResultFilter(resultStatus, resultFilter)}>
      <div className="ib-inline-result">
      <div className="ib-status-center">{content}</div>
      {delta?.metrics?.length > 0 && !running && <ResultDetails className="ib-comparison-details" tooltipId={`${key}-changes`} overlay={<><p className="ib-preview-metrics">{delta.detail}</p>{preview}</>}>
      <ResultDeltaGutter metrics={delta.metrics} detail={delta.detail} /></ResultDetails>}
      </div>
    </td>;
    mobileCells.push({ key, stage, position: Number(position), arch, cell, resultStatus, running });
    return cell;
  }

  const renderRowCells = ({ resultType, ifWarning, ifError, ifFailed, ifPassed, ifUnknown }) => {
    return data.map((ib, pos) => {
      const el = archsByIb[pos];

      return (el?.archs || []).map((arch) => {
        const cellKey = `${resultType}-${pos}-${arch}`;
        const results = _.findWhere(ib[resultType] || [], { arch });

        if (!results) return renderCell(<span className="text-muted">—</span>, `${cellKey}-missing`);

        if (_.isEmpty(results)) {
          return renderCell(
            renderStatusMarker({
              status: 'secondary',
              icon: <FaQuestionCircle />,
              value: '?',
              type: resultType,
              details: { status: 'No data available' },
              tooltipId: `${cellKey}-tooltip-empty`
            }) || <span className="text-muted">—</span>,
            `${cellKey}-empty`
          );
        }

        switch (results.passed) {
          case true:
          case "passed":
            return ifPassed
              ? ifPassed(results, ib.release_name, cellKey)
              : renderCell(
                  renderStatusMarker({
                    status: 'success',
                    icon: <FaCheck />,
                    value: results.details?.num_passed || '✓',
                    type: resultType,
                    details: results.details,
                    tooltipId: `${cellKey}-tooltip-passed`
                  }) || <span className="text-muted">—</span>,
                  `${cellKey}-passed`
                );

          case false:
          case "error":
            return ifError
              ? ifError(results, ib.release_name, cellKey)
              : renderCell(
                  renderStatusMarker({
                    status: 'danger',
                    icon: <FaTimes />,
                    value: results.details?.num_errors || '✗',
                    type: resultType,
                    details: results.details,
                    tooltipId: `${cellKey}-tooltip-error`
                  }) || <span className="text-muted">—</span>,
                  `${cellKey}-error`
                );

          case "failed":
            return ifFailed
              ? ifFailed(results, ib.release_name, cellKey)
              : renderCell(
                  renderStatusMarker({
                    status: 'danger',
                    icon: <FaTimes />,
                    value: results.details?.num_fails || '!',
                    type: resultType,
                    details: results.details,
                    tooltipId: `${cellKey}-tooltip-failed`
                  }) || <span className="text-muted">—</span>,
                  `${cellKey}-failed`
                );

          case "warning":
            return ifWarning
              ? ifWarning(results, ib.release_name, cellKey)
              : renderCell(
                  renderStatusMarker({
                    status: 'warning',
                    icon: null,
                    value: results.details?.num_warnings || '⚠',
                    type: resultType,
                    details: results.details,
                    tooltipId: `${cellKey}-tooltip-warning`
                  }) || <span className="text-muted">—</span>,
                  `${cellKey}-warning`
                );

          case "unknown":
            return ifUnknown
              ? ifUnknown(arch, ib, cellKey)
              : renderCell(
                  renderStatusMarker({
                    status: 'secondary',
                    icon: <FaQuestionCircle />,
                    value: ' ',
                    type: resultType,
                    details: { status: 'Unknown' },
                    tooltipId: `${cellKey}-tooltip-unknown`
                  }) || <span className="text-muted">—</span>,
                  `${cellKey}-unknown`
                );

          default:
            return renderCell(renderStatusMarker({ status: 'secondary', value: '—', type: resultType, details: { status: results.passed || 'Not available' } }), `${cellKey}-default`);
        }
      });
    });
  };

  const showGeneralResults = (
    labelConfigArray = [],
    getUrl,
    urlParameter = '',
    tooltipOptions = {}
  ) => (result, ib, cellKey = `${result?.arch || 'arch'}-${ib || 'ib'}`) => {
    const { details, done } = result;
    if (!details) return renderCell(<span className="text-muted">—</span>, `${cellKey}-no-details`);

    const resultKeys = Object.keys(details);
    let labelConfig = { value: 0, colorType: 'secondary' };

    for (let el of labelConfigArray) {
      el.groupFields.forEach((predicate) => {
        if (typeof predicate === "function") {
          resultKeys.forEach((key) => {
            if (predicate(key)) labelConfig.value += details[key] * 1;
          });
        } else {
          if (valueInTheList(resultKeys, predicate)) labelConfig.value += details[predicate] * 1;
        }
      });
      if (labelConfig.value > 0) {
        labelConfig.colorType = el.color;
        break;
      }
    }

    if (labelConfig.value === 0) return renderCell(<span className="text-muted">—</span>, `${cellKey}-zero`);


    const status = labelConfig.colorType === 'danger'
      ? 'danger'
      : labelConfig.colorType === 'warning'
        ? 'warning'
        : labelConfig.colorType === 'success'
          ? 'success'
          : 'secondary';

    const resultType = ({ builds: 'Build', utests: 'Unit tests', addons: 'AddOn', dupDict: 'Q/A duplicates' })[cellKey.split('-')[0]] || 'Test';

    const tooltipDetails = tooltipOptions.hideFile
      ? removeKeysFromDetails(details, ['file'])
      : details;

    const cell = renderStatusMarker({
      status,
      icon: statusIcons[status],
      value: labelConfig.value,
      details: tooltipDetails,
      type: resultType,
      link: getUrl({ file: result.file, arch: result.arch, ibName: ib, urlParameter }),
      tooltipId: `${cellKey}-tooltip-general`
    });

    return renderCell(cell || <span className="text-muted">—</span>, `${cellKey}-general`);
  };

  const showRelValsResults = (labelConfigArray = [], getUrl) => (result, ib, cellKey = `${result?.arch || 'arch'}-${ib || 'ib'}`) => {
    const { details, done } = result;
    const labelConfig = checkLabelType(labelConfigArray, details) || {
      value: 0,
      colorType: "secondary"
    };

    if (labelConfig.value === 0) return renderCell(<span className="text-muted">—</span>, `${cellKey}-zero`);


    let selectedStatus = '';
    switch (labelConfig.colorType) {
      case "danger":
        selectedStatus = "&selectedStatus=failed";
        break;
      case "warning":
        selectedStatus = "&selectedFlavors=X&selectedStatus=failed&selectedStatus=known_failed";
        break;
      case "success":
        selectedStatus = "&selectedFlavors=X&selectedStatus=failed&selectedStatus=known_failed&selectedStatus=passed";
        break;
      default:
        break;
    }

    const status = labelConfig.colorType === 'danger'
      ? 'danger'
      : labelConfig.colorType === 'warning'
        ? 'warning'
        : labelConfig.colorType === 'success'
          ? 'success'
          : 'secondary';

    const cell = renderStatusMarker({
      status,
      icon: statusIcons[status],
      value: labelConfig.value,
      details,
      type: 'RelVal',
      link: getUrl({ file: result.file, arch: result.arch, ibName: ib, selectedStatus }),
      tooltipId: `${cellKey}-tooltip-relval`
    });

    return renderCell(cell || <span className="text-muted">—</span>, `${cellKey}-relval`);
  };

  const shouldShowRow = (resultType) => {
    return data.reduce((sum, ib, pos) => {
      const el = archsByIb[pos] || {};
      const count = (el.archs || [])
        .map((arch) => (_.findWhere(ib[resultType] || [], { arch }) ? 1 : 0))
        .reduce((a, b) => a + b, 0);
      return sum + count;
    }, 0) > 0;
  };

  let matrix = (
    <div className="container-fluid px-0">
      <div className="ib-table-frame">
        {hasOverflow && <p className="ib-table-scroll-hint">Scroll horizontally to see all architectures <span aria-hidden="true">→</span></p>}
        <div
          ref={tableContainer}
          className="table-responsive ib-table-responsive"
          tabIndex={hasOverflow ? 0 : undefined}
          aria-label={hasOverflow ? "Build results table; scroll horizontally for more architectures" : undefined}
        >
          <style>
            {`
              .type-label-mobile,
              .type-header-mobile {
                display: none;
              }

              .type-label-desktop,
              .type-header-desktop {
                display: inline-flex;
                align-items: center;
                justify-content: center;
              }

              .custom-tooltip .tooltip-inner {
                background-color: white;
                color: ${THEME.text.primary};
                border: 1px solid ${THEME.border};
                box-shadow: 0 10px 25px -5px rgba(0,0,0,0.2);
                max-width: 350px;
                border-radius: 12px;
                padding: 0;
                opacity: 1 !important;
              }

              .custom-tooltip {
                opacity: 1 !important;
              }

              .custom-tooltip .tooltip-arrow::before {
                border-top-color: white !important;
              }

              .arch-stack-item {
                padding: 5px 10px;
                color: white;
                font-size: 0.85rem;
                font-weight: 800;
                text-align: center;
                border-bottom: 1px solid rgba(255,255,255,0.2);
                white-space: nowrap;
                line-height: 1.1;
              }

              .arch-stack-item:last-child {
                border-bottom: none;
              }

              .sphere-success svg {
                color: #ffffff !important;
                fill: #ffffff !important;
              }

              .enhanced-sphere svg {
                fill: currentColor;
              }

              .flavor-card-wrapper {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
              }

              .flavor-copy-button {
                opacity: 0;
                border: none;
                background: transparent;
                color: #475569;
                padding: 0;
                display: inline-flex;
                align-items: center;
                cursor: pointer;
              }

              .flavor-card-wrapper:hover .flavor-copy-button {
                opacity: 1;
              }

              @media (max-width: 768px) {

                .type-label-desktop,
                .type-header-desktop {
                  display: none !important;
                }

                .type-label-mobile,
                .type-header-mobile {
                  display: inline-flex !important;
                  align-items: center;
                  justify-content: center;
                }

                .name-column svg {
                  font-size: 0.9rem;
                }

                .arch-stack-item {
                  padding: 4px 6px;
                  font-size: 0.78rem;
                }
              }
            `}
          </style>

          <Table
            striped={false}
            hover
            className="mb-0 align-middle"
            style={{ '--ib-column-count': configurations.length }}
          >
            <colgroup>
              <col className="ib-stage-column" />
              {configurations.map(item => <col key={item.key} className="ib-configuration-column" />)}
            </colgroup>
            <thead>
              {historyArchs && <tr className="ib-history-day-row">
                <th scope="col" className="ib-history-direction"><span>Newest</span><small>→ older</small></th>
                {historyDays.map(group => <th key={group.day} colSpan={group.columns}
                  className="ib-history-day-heading ib-history-day-start" scope="colgroup">
                  <time dateTime={group.day}>{group.day}</time>
                </th>)}
              </tr>}
              <tr>
                <th className="name-column" rowSpan={2} style={{ verticalAlign: 'middle' }}>
                  <div className="d-flex align-items-center justify-content-center h-100">
                    <span className="type-header-desktop ib-stage-corner"><span>Stage</span><small>Config →</small></span>
                    <span className="type-header-mobile fw-bold text-uppercase" style={{ fontSize: "var(--ui-type-caption)" }} />
                  </div>
                </th>

                {archsByIb.map((item, pos) => {
                  if (!item.archs?.length) return null;

                  const stamp = data[pos].release_name.slice(item.flavor.length + 1);
                  const flavorLabel = historyArchs ? (new Set(data.map(ib => ib.release_queue)).size > 1 ? `${formatFlavorLabel(item.flavor)} · ` : '') + stamp.replace(/^(.*)-(..)(..)$/, '$1 · $2:$3') : formatFlavorLabel(item.flavor);
                  const headerContent = historyArchs ? (
                    <span className="ib-history-heading">
                      <span>{formatFlavorLabel(item.flavor)}</span>
                      <time dateTime={stamp.replace(/-(\d{2})(\d{2})$/, 'T$1:$2')}>
                        <span className="ib-history-time"><span className="ib-family-dot" aria-hidden="true" />
                          {stamp.slice(11, 13)}:{stamp.slice(13, 15)}
                        </span>
                      </time>
                      {historyLatest.includes(data[pos].release_name) && <small className="ib-history-latest">Latest</small>}
                    </span>
                  ) : <OverflowLabel text={flavorLabel} />;
                  const familyState = familyBuildState(data[pos], item.archs);
                  const releaseNameToCopy = item.current_tag || data[pos]?.release_name || '';

                  const flavorLink = releaseNameToCopy
                    ? `https://github.com/cms-sw/cmssw/tree/${releaseNameToCopy}`
                    : null;

                  const flavorCardStyle = {
                    background: FLAVOR_CARDS[0].bg,
                    color: FLAVOR_CARDS[0].text,
                    padding: 'var(--ui-space-1) var(--ui-space-2)',
                    borderRadius: 'var(--ui-radius-sm)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: "var(--ui-type-label)",
                    fontWeight: 800,
                    margin: '0 auto',
                    cursor: flavorLink ? 'pointer' : 'default'
                  };

                  return (
                    <th
                      key={`flavor-${pos}-${item.flavor}`}
                      className={`ib-group-start ${historyBoundaries.get(pos) || ''} ib-family-header ib-config-${familyState.status} ${familyState.running ? 'is-running' : ''}`}
                      colSpan={item.archs.length}
                      style={{
                        textAlign: 'center',
                        padding: '6px 2px',
                        backgroundColor: THEME.light
                      }}
                    >
                      <div className="flavor-card-wrapper">
                        {!historyArchs && ibIdentity(data[pos]) && (
                          <button type="button" className="ib-history-trigger" aria-haspopup="dialog"
                            aria-label={`View ${flavorLabel} build history`} title={`View ${flavorLabel} build history`}
                            onClick={() => openHistory(pos)}><FaHistory aria-hidden="true" /></button>
                        )}
                        {flavorLink ? (
                          <a
                            href={flavorLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ textDecoration: 'none', display: 'inline-block' }}
                            title={`Open ${releaseNameToCopy}`}
                          >
                            <div className="flavor-card" style={flavorCardStyle}>
                              {!historyArchs && <span className="ib-family-dot" aria-hidden="true" />}
                              {headerContent}
                            </div>
                          </a>
                        ) : (
                          <div className="flavor-card" style={flavorCardStyle} title={flavorLabel}>
                            {!historyArchs && <span className="ib-family-dot" aria-hidden="true" />}
                            {headerContent}
                          </div>
                        )}

                        {releaseNameToCopy && (
                          <button
                            type="button"
                            className="flavor-copy-button"
                            title={copiedText === releaseNameToCopy ? 'Copied!' : `Copy ${releaseNameToCopy}`}
                            aria-label={copiedText === releaseNameToCopy ? 'Copied!' : `Copy ${releaseNameToCopy}`}
                            onClick={(e) => handleCopy(e, releaseNameToCopy)}
                          >
                            {copiedText === releaseNameToCopy ? <FaCheck size={11} /> : <FaCopy size={11} />}
                          </button>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>

              <tr>
                {archsByIb.map((item, pos) => (item.archs || []).map((arch, archIndex) => {
                  let link = null;
                  let isPatch = false;
                  let baseTag = '';

                  const { cmsdistTags, current_tag } = item;
                  const cmsdistTag = cmsdistTags?.[arch];

                  if (cmsdistTag && cmsdistTag !== "Not Found") {
                    link = urls.commits + cmsdistTag;
                    isPatch = checkIfItIsAPatch(current_tag, arch, cmsdistTag);
                    if (isPatch) {
                      baseTag = cmsdistTag.replace('IB/', '').replace(`/${arch}`, '');
                    }
                  }



                  const buildTypePrefixIcon = cmsdistTag && cmsdistTag !== "Not Found"
                    ? (
                        isPatch
                          ? <span title="Patch build: reuses CMSDist tag"><FaTools size={13} /></span>
                          : <span title="Full build: dedicated CMSDist tag"><FaWrench size={13} /></span>
                      )
                    : null;

                  const headerState = configurationBuildState(data[pos], arch);
                  const archStack = <ArchitectureHeader architecture={arch} icon={buildTypePrefixIcon} status={headerState.status} running={headerState.running} colors={configurationColors} productionColor={config.colorCoding.prodColor} />;

                  const cellContent = link ? (
                    <OverlayTrigger
                      placement="top"
                      overlay={
                        <Tooltip id={`arch-tooltip-${pos}-${makeSafeId(arch)}`} className="custom-tooltip">
                          <ArchTooltip cmsdistTag={cmsdistTag} isPatch={isPatch} baseTag={baseTag} />
                        </Tooltip>
                      }
                      delay={tooltipDelayInMs}
                    >
                      <a className="ib-config-content" href={link} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
                        {archStack}
                      </a>
                    </OverlayTrigger>
                  ) : (
                    <div className="ib-config-content">{archStack}</div>
                  );

                  return (
                    <th
                      key={`arch-${pos}-${arch}`}
                      className={`ib-config-header ib-config-${headerState.status} ${headerState.running ? 'is-running' : ''} ${archIndex === 0 ? `ib-group-start ${historyBoundaries.get(pos) || ''} ` : ""}`}
                      style={{
                        padding: '3px 2px',
                        backgroundColor: THEME.light,
                        minWidth: '72px'
                      }}
                    >
                      {cellContent}
                    </th>
                  );
                }))}
              </tr>
            </thead>

            <tbody>
              {shouldShowRow("builds") && (
                <tr data-stage="builds">
                  <td className="name-column fw-semibold">
                    {renderStickyRowLabel('builds')}
                  </td>
                  {data.map((ib, pos) => {
                    const el = archsByIb[pos];

                    return (el?.archs || []).map((arch) => {
                      const cellKey = `builds-${pos}-${arch}`;
                      const results = _.findWhere(ib.builds || [], { arch });

                      if (!results) return renderCell(<span className="text-muted">—</span>, `${cellKey}-missing`);

                      if (_.isEmpty(results)) {
                        return renderCell(
                          renderStatusMarker({
                            status: 'secondary',
                            icon: <FaQuestionCircle />,
                            value: '?',
                            type: 'Builds',
                            details: { status: 'No data available' },
                            link: getBuildOrUnitUrl({
                              file: results.file,
                              arch: results.arch,
                              ibName: ib.release_name
                            }),
                            tooltipId: `${cellKey}-tooltip-empty`
                          }) || <span className="text-muted">—</span>,
                          `${cellKey}-empty`
                        );
                      }

                      switch (results.passed) {
                        case true:
                        case "passed":
                          return renderCell(
                            renderStatusMarker({
                              status: 'success',
                              icon: <FaCheck />,
                              value: ' ',
                              type: 'Builds',
                              details: {},
                              link: getBuildOrUnitUrl({
                                file: results.file,
                                arch: results.arch,
                                ibName: ib.release_name
                              }),
                              tooltipId: `${cellKey}-tooltip-passed`
                            }),
                            `${cellKey}-passed`
                          );

                        case false:
                        case "error":
                        case "failed":
                        case "warning":
                          return showGeneralResults([
                            { groupFields: [(key) => key.includes("Error")], color: "danger" },
                            { groupFields: ["compWarning"], color: "warning" }
                          ], getBuildOrUnitUrl)(results, ib.release_name, cellKey);

                        default:
                          return renderCell(<span className="text-muted">—</span>, `${cellKey}-default`);
                      }
                    });
                  })}
                </tr>
              )}

              {shouldShowRow("utests") && (
                <tr data-stage="utests">
                  <td className="name-column fw-semibold">
                    {renderStickyRowLabel('utests')}
                  </td>
                  {renderRowCells({
                    resultType: 'utests',
                    ifPassed: (details, ibName, cellKey) => renderCell(renderStatusMarker({
                      status: 'success',
                      icon: <FaCheck />,
                      value: details.details?.num_passed || ' ',
                      type: 'Unit Tests',
                      details: {},
                      link: getBuildOrUnitUrl({
                        file: details.file,
                        arch: details.arch,
                        ibName,
                        urlParameter: '?utests'
                      }),
                      tooltipId: `${cellKey}-tooltip-passed`
                    }), `${cellKey}-passed`),
                    ifError: showGeneralResults([{ groupFields: ["num_errors"], color: "danger" }], getBuildOrUnitUrl, '?utests'),
                    ifFailed: showGeneralResults([{ groupFields: ["num_fails"], color: "danger" }], getBuildOrUnitUrl, '?utests'),
                    ifWarning: showGeneralResults([{ groupFields: ["num_warnings"], color: "warning" }], getBuildOrUnitUrl, '?utests')
                  })}
                </tr>
              )}

              {shouldShowRow("relvals") && (
                <tr data-stage="relvals">
                  <td className="name-column fw-semibold">
                    <a
                      href={urls.newRelVals(que, date)}
                      className="text-decoration-none d-flex align-items-center ib-row-label-link"
                      style={{ color: THEME.text.primary, height: '100%' }}
                      title="RelVal"
                    >
                      <span className="type-label-desktop">RelVal</span>
                      <span className="type-label-mobile">
                        <FaLayerGroup size={12} />
                      </span>
                    </a>
                  </td>
                  {renderRowCells({
                    resultType: 'relvals',
                    ifPassed: showRelValsResults(showLabelConfig.relvals || [], getRelValUrl),
                    ifError: showRelValsResults(showLabelConfig.relvals || [], getRelValUrl),
                    ifFailed: showRelValsResults(showLabelConfig.relvals || [], getRelValUrl),
                    ifWarning: showRelValsResults(showLabelConfig.relvals || [], getRelValUrl)
                  })}
                </tr>
              )}

              {shouldShowRow("addons") && (
                <tr data-stage="addons">
                  <td className="name-column fw-semibold">
                    {renderStickyRowLabel('addons')}
                  </td>
                  {renderRowCells({
                    resultType: 'addons',
                    ifPassed: (details, ibName, cellKey) => renderCell(renderStatusMarker({
                      status: 'success',
                      icon: <FaCheck />,
                      value: ' ',
                      type: 'Other Tests',
                      details: removeKeysFromDetails(details, ['file']),
                      link: getOtherTestUrl({ file: details.file, arch: details.arch, ibName }),
                      tooltipId: `${cellKey}-tooltip-passed`
                    }), `${cellKey}-passed`),
                    ifError: (details, ibName, cellKey) => renderCell(renderStatusMarker({
                      status: 'danger',
                      icon: <FaTimes />,
                      value: ' ',
                      type: 'Other Tests',
                      details: removeKeysFromDetails(details, ['file']),
                      link: getOtherTestUrl({ file: details.file, arch: details.arch, ibName }),
                      tooltipId: `${cellKey}-tooltip-error`
                    }), `${cellKey}-error`),
                    ifFailed: showGeneralResults(showLabelConfig.addons || [], getOtherTestUrl, '', { hideFile: true }),
                    ifWarning: showGeneralResults(showLabelConfig.addons || [], getOtherTestUrl, '', { hideFile: true })
                  })}
                </tr>
              )}

              {shouldShowRow("dupDict") && (
                <tr data-stage="dupDict">
                  <td className="name-column fw-semibold">
                    {renderStickyRowLabel('dupDict')}
                  </td>
                  {renderRowCells({
                    resultType: 'dupDict',
                    ifPassed: (details, ibName, cellKey) => renderCell(renderStatusMarker({
                      status: 'success',
                      icon: <FaCheck />,
                      value: ' ',
                      type: 'Q/A',
                      details: { status: 'No duplicates found' },
                      link: urls.q_a(details.arch, ibName),
                      tooltipId: `${cellKey}-tooltip-passed`
                    }), `${cellKey}-passed`),
                    ifError: (details, ibName, cellKey) => renderCell(renderStatusMarker({
                      status: 'danger',
                      icon: <FaTimes />,
                      value: ' ',
                      type: 'Q/A',
                      details: { status: 'Duplicate found' },
                      link: urls.q_a(details.arch, ibName),
                      tooltipId: `${cellKey}-tooltip-error`
                    }), `${cellKey}-error`),
                    ifFailed: showGeneralResults(showLabelConfig.dupDict || [], urls.q_a),
                    ifWarning: showGeneralResults(showLabelConfig.dupDict || [], urls.q_a)
                  })}
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  );
  const counts = summarizeMatrix(matrix);
  const hiddenStages = new Set(resultFilter === 'issues' ? stages.filter(stage => {
    const cells = mobileCells.filter(cell => cell.stage === stage);
    return cells.length > 0 && cells.every(cell => cell.resultStatus === 'success' && !cell.running);
  }) : []);
  const hidePassingRows = node => {
    if (Array.isArray(node)) return node.map(hidePassingRows);
    if (!React.isValidElement(node)) return node;
    if (node.type === 'tbody') {
      return React.cloneElement(node, {}, React.Children.toArray(node.props.children)
        .filter(row => !hiddenStages.has(row.props?.['data-stage'])));
    }
    // Traverse only table containers. Keep styles, headers and result cells intact.
    if (node.type !== 'div' && node.type !== Table) return node;
    return React.cloneElement(node, {}, hidePassingRows(node.props.children));
  };
  if (hiddenStages.size) matrix = hidePassingRows(matrix);
  useEffect(() => { onCountsChange?.(counts); },
    [onCountsChange, counts.success, counts.danger, counts.warning, counts.secondary, counts.info]);
  return (
    <section ref={sectionRef} className="ib-matrix-section" data-in-view={inView} data-result-filter={resultFilter} aria-label="Build test matrix">
      {resultFilter !== 'all' && <p className="visually-hidden" role="status">{resultFilter === 'issues' ? 'Failures and warnings' : resultFilter === 'danger' ? 'Failures' : resultFilter === 'warning' ? 'Warnings' : 'Passed results'} highlighted. Fully passing stages are hidden.</p>}
      {!historyArchs && <div className="ib-phone-controls">
        <div className="ib-phone-column-navigation">
          <button type="button" className="btn btn-light" aria-label="Previous configuration"
            disabled={selectedIndex <= 0} onClick={() => selectNeighbour(-1)}>←</button>
          <select aria-label="Configuration" value={selected?.key || ''}
            onChange={event => setConfiguration(event.target.value)}>
            {!configurations.length && <option value="">No configurations selected</option>}
            {configurations.map(item => <option key={item.key} value={item.key}>{formatFlavorLabel(item.flavor)} · {item.arch}</option>)}
          </select>
          <button type="button" className="btn btn-light" aria-label="Next configuration"
            disabled={selectedIndex < 0 || selectedIndex >= configurations.length - 1}
            onClick={() => selectNeighbour(1)}>→</button>
        </div>
        <div className="ib-phone-view-actions">
          <button type="button" className="btn btn-light" aria-pressed={compareOnPhone}
            onClick={() => setCompareOnPhone(value => !value)}>{compareOnPhone ? 'Single configuration' : 'Compare configurations'}</button>
          {selected && ibIdentity(data[selected.position]) && <button type="button" className="btn btn-light"
            onClick={() => openHistory(selected.position)}>View {formatFlavorLabel(selected.flavor)} history</button>}
        </div>
      </div>}
      {!historyArchs && <div className={`ib-phone-results ${compareOnPhone ? 'is-hidden' : ''}`}
        onTouchStart={event => {
          const touch = event.touches[0];
          phoneTouch.current = {x:touch.clientX, y:touch.clientY};
        }}
        onTouchEnd={event => {
          const start = phoneTouch.current, touch = event.changedTouches[0];
          phoneTouch.current = null;
          if (!start || !touch) return;
          const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) selectNeighbour(dx < 0 ? 1 : -1);
        }}
        onTouchCancel={() => { phoneTouch.current = null; }}>
        {selected && isPhone ? <>
          <p className="ib-phone-column-position" aria-live="polite">Configuration {selectedIndex + 1} of {configurations.length}</p>
          <Table className="ib-phone-column-table mb-0 align-middle" style={{width:'100%', tableLayout:'fixed'}}>
            <colgroup><col style={{width:'34%'}} /><col style={{width:'66%'}} /></colgroup>
            <thead>
              <tr>
                <th rowSpan={2} className="name-column"><span className="ib-stage-corner"><span>Stage</span><small>Config →</small></span></th>
                <th className={`ib-family-header ib-config-${configurationBuildState(data[selected.position], selected.arch).status}`}>
                  <div className="flavor-card-wrapper"><span className="flavor-card">
                    <span className="ib-family-dot" aria-hidden="true" />{formatFlavorLabel(selected.flavor)}
                  </span></div>
                </th>
              </tr>
              <tr><th className={`ib-config-header ib-config-${configurationBuildState(data[selected.position], selected.arch).status}`}>
                <div className="ib-config-content"><ArchitectureHeader architecture={selected.arch}
                  status={configurationBuildState(data[selected.position], selected.arch).status}
                  colors={configurationColors} productionColor={config.colorCoding.prodColor} /></div>
              </th></tr>
            </thead>
            <tbody>
              {mobileCells.filter(item => item.position === selected.position && item.arch === selected.arch && !hiddenStages.has(item.stage)).map(item =>
                <tr key={item.key}><th className="name-column" scope="row">{rowLabelConfig[item.stage]?.text || item.stage}</th>{item.cell}</tr>)}
            </tbody>
          </Table>
        </> : <p>Select architectures to see results.</p>}
      </div>}
      <div className={`ib-comparison-matrix ${historyArchs || compareOnPhone ? 'is-phone-visible' : ''}`}>{matrix}</div>
      {!historyArchs && <MatrixHelp />}
      {history && <Modal show onHide={() => setHistory(null)} size="xl" fullscreen="md-down"
        scrollable centered aria-label={'Build history'} className="ib-history-window"
        style={historyWindow.style} onPointerDownCapture={historyWindow.onPointerDownCapture}>
        <Modal.Header closeButton>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 w-100 me-2">
            <Modal.Title>Build history</Modal.Title>
            {historyWindow.controls}
            <ResultFilter filter={historyFilter} onChange={setHistoryFilter}
              counts={hasHistoryResults ? historyCounts : { success: 0, danger: 0, warning: 0, secondary: 0, info: 0 }} />
          </div>
        </Modal.Header>
        <Modal.Body className="ib-history-body">
          <p>{visibleHistoryBuilds.length} {visibleHistoryBuilds.length === 1 ? 'build' : 'builds'} · Newest → oldest</p>
          {missingFlavours.length > 0 && <div role="status" className="alert alert-light border">
            {missingFlavours.map(queue => <p key={queue} className="mb-1">No {formatFlavorLabel(queue)}_X build available for the selected architectures
              {selectedHistoryArchs.length > 0 ? `: ${selectedHistoryArchs.join(', ')}` : '.'}</p>)}
          </div>}
          <div className="ib-history-architectures">
            <strong>Architectures</strong>
            <TogglesShowArchs releaseQue={releaseQue} architectures={historyOptions} selection={history.filters}
              onSelectionChange={filters => setHistory(previous => ({ ...previous, filters }))} />
          </div>
          <details className="ib-history-flavours mb-3">
            <summary>Compare flavours</summary>
            <div className="d-flex flex-wrap gap-3 border rounded p-3 mt-2" role="group" aria-label="Flavours">
              {flavourOptions.map(ib => {
                const selected = history.builds.some(build => build.release_queue === ib.release_queue);
                const selectedQueues = new Set(history.builds.map(build => build.release_queue));
                return <label key={ib.release_queue} className="d-inline-flex align-items-center gap-2">
                  <input type="checkbox" checked={selected} disabled={selected && selectedQueues.size === 1}
                    onChange={({ target }) => {
                      const queues = new Set(selectedQueues);
                      if (target.checked) queues.add(ib.release_queue);
                      else queues.delete(ib.release_queue);
                      const selectedFlavours = flavourOptions.filter(option => queues.has(option.release_queue))
                        .map(option => queues.size === 1 && option.release_queue === history.anchor.release_queue
                          ? history.anchor : option);
                      const builds = selectHistoryBuilds(selectedFlavours, comparisons.keys(), showAllHistory);
                      setHistory(previous => ({ ...previous, builds }));
                    }} />
                  {formatFlavorLabel(ib.release_queue)}
                </label>;
              })}
            </div>
          <label className="d-flex align-items-center gap-2 mb-3">
            <input type="checkbox" checked={showAllHistory} onChange={({ target }) => {
              const selectedQueues = new Set(history.builds.map(ib => ib.release_queue));
              const anchors = flavourOptions.filter(option => selectedQueues.has(option.release_queue))
                .map(option => selectedQueues.size === 1 && option.release_queue === history.anchor.release_queue
                  ? history.anchor : option);
              setShowAllHistory(target.checked);
              setHistory(previous => ({ ...previous,
                builds: selectHistoryBuilds(anchors, comparisons.keys(), target.checked) }));
            }} />
            Show all builds chronologically
          </label>
          </details>
          {hasHistoryResults ? <ComparisonTable data={history.builds} comparisons={comparisons}
            historyArchs={selectedHistoryArchs} releaseQue={releaseQue}
            historyLatest={flavourOptions.map(ib => ib.release_name)}
            resultFilter={historyFilter} onCountsChange={setHistoryCounts} /> : <p>{selectedHistoryArchs.length ? "No results for the selected architectures." : "Select an architecture to see its results."}</p>}
        </Modal.Body>
      </Modal>}
    </section>
  );
};

ComparisonTable.propTypes = {
  data: PropTypes.array.isRequired,
  releaseQue: PropTypes.string.isRequired
};

export default ComparisonTable;
