import { shadeStageOutliers } from "../../Utils/matrixHeat";
import { stages } from "../../Utils/resultDelta";
import { compareCell } from "../../Utils/ibComparison";
import BuildSummary from "../common/BuildSummary";
import { summarizeMatrix } from "../../Utils/matrixSummary";
import ArchitectureHeader from "../common/ArchitectureHeader";
import { tableTheme as THEME } from "../../styles/theme";
import React, { useMemo, useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { Button, ButtonGroup, OverlayTrigger, Table, Tooltip } from "react-bootstrap";
import {
  checkLabelType,
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

const StatusTooltip = ({ status, value, details, type }) => {
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
        <div className={`ib-status-marker ib-status-${status} ${status === "success" ? "is-pass" : status === "danger" ? "is-fail" : ""} ${running ? "is-running" : ""}`}>
          {style.sphereIcon}
        </div>
        <span className="fw-semibold ms-2">{type || 'Status'} Information</span>
      </div>

      <div className="mb-2">
        <div className="d-flex align-items-center mb-1">
          <FaInfoCircle className="text-info me-2" size={12} />
          <span className="text-muted small fw-semibold">Current Status:</span>
        </div>
        <div className="d-flex align-items-center mt-1">
          <div className={`ib-status-marker ib-status-${status} ${status === "success" ? "is-pass" : status === "danger" ? "is-fail" : ""} ${running ? "is-running" : ""}`}>
            {style.sphereIcon}
          </div>
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
  return (
    <OverlayTrigger
      placement="top"
      overlay={<Tooltip id={tooltipId} className="custom-tooltip p-0">{tooltipContent}</Tooltip>}
      delay={tooltipDelayInMs}
    >
      <span className="d-inline-block">{cellContent}</span>
    </OverlayTrigger>
  );
}

function baseRenderCell(cellInfo, key) {
  return (
    <td key={key} className="align-middle p-1" style={{ textAlign: 'center', verticalAlign: 'middle' }}>
      {cellInfo}
    </td>
  );
}

function renderStatusMarker({ status = "secondary", value, icon, link, tooltipContent, details, type, tooltipId, running = false } = {}) {
  const style = statusStyles[status] || statusStyles.secondary;
  const displayValue = value !== undefined ? value : '';

  if (displayValue === 0 || displayValue === '') return null;

  const hasNumericValue =
    typeof displayValue === 'number' ||
    (typeof displayValue === 'string' && /\d/.test(displayValue));

  const resolvedIcon = hasNumericValue
    ? null
    : (icon === null ? null : (icon || style.sphereIcon));

  const metric = type?.toLowerCase().includes('build') ? (status === 'warning' ? 'compiler warnings' : 'build errors') : type === 'Q/A' ? 'duplicate-check outcome' : 'test results';
  const sphereContent = (
    <span className={`ib-status-marker ib-status-${status} ${status === "success" ? "is-pass" : status === "danger" ? "is-fail" : ""} ${running ? "is-running" : ""}`}
      role="img" data-result-status={status} data-running={running || undefined} data-result-count={hasNumericValue ? Number.parseFloat(displayValue) : undefined} title={`${displayValue} ${metric}`} aria-label={`${running ? "Running — partial result. " : ""}${type || 'Test'}: ${statusStyles[status]?.description || 'Unknown'}${hasNumericValue ? ` (${displayValue} ${metric})` : ''}`}>
      <span className="ib-status-circle dot" aria-hidden="true"><span className="ib-status-fill" /><span className="ib-status-sweep" /><span className="ib-status-glyph">{status === 'success' || status === 'danger' ? <svg viewBox="0 0 16 16"><path d={status === 'success' ? 'M3.5 8.4l3 3 6-6.4' : 'M4.5 4.5l7 7M11.5 4.5l-7 7'} /></svg> : style.sphereIcon}</span></span>{hasNumericValue && <span className="ib-status-count">{displayValue}</span>}
    </span>
  );

  const enhancedTooltip = tooltipContent || (
    <StatusTooltip
      status={status}
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

const ComparisonTable = ({ data = [], comparisons = new Map(), releaseQue }) => {
  const [copiedText, setCopiedText] = useState(null);
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const tableContainer = useRef(null);
  const { getActiveArchsForQue = () => [] } = useShowArch();

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

  const { que, date } = useMemo(() => {
    if (data[0]) {
      const [, q, , d] = getInfoFromRelease(data[0].release_name);
      return { que: q, date: d };
    }
    return {};
  }, [data]);

  const archsByIb = useMemo(
    () => getAllActiveArchitecturesFromIBGroupByFlavor(data, activeArchs),
    [data, activeArchs]
  );

  useEffect(() => {
    const container = tableContainer.current;
    if (!container) return undefined;
    const measure = () => setHasOverflow(container.scrollWidth > container.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    const table = container.querySelector('table');
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [archsByIb]);

  function renderCell(cellInfo, key) {
    const [stage, position] = key.split('-');
    const ib = data[Number(position)];
    const arch = (ib?.tests_archs || []).filter(value => key === `${stage}-${position}-${value}` || key.startsWith(`${stage}-${position}-${value}-`)).sort((a, b) => b.length - a.length)[0];
    const candidates = ib?.[stage]?.filter(item => item.arch === arch) || [];
    const current = candidates.length === 1 ? candidates[0] : null;
    const context = comparisons.get(ib);
    const delta = stages.includes(stage) ? compareCell(ib, context, stage, arch) : null;
    const running = current?.done === false;
    let hasMarker = false;
    const decorate = node => {
      if (Array.isArray(node)) return node.map(decorate);
      if (!React.isValidElement(node)) return node;
      if (node.props['data-result-status']) {
        hasMarker = true;
        const status = node.props['data-result-status'];
        const label = status === 'success' ? 'Running — passing so far' : status === 'danger' ? 'Running — failures detected' : 'Running — partial result';
        return React.cloneElement(node, { className: `${node.props.className} ${running ? 'is-running' : ''}`, 'data-running': running || undefined, 'aria-label': `${running ? label : current?.done === true ? "Completed" : "Reported"}. ${node.props['aria-label']}` });
      }
      const extra = running && node.props.overlay ? { overlay: React.cloneElement(node.props.overlay, {}, <><strong>Running — partial results, not final.</strong>{node.props.overlay.props.children}</>) } : {};
      return React.cloneElement(node, extra, decorate(node.props.children));
    };
    let content = decorate(cellInfo);
    if (running && !hasMarker) content = renderStatusMarker({ status: 'secondary', value: ' ', running: true, type: stage });
    const boundary = arch === archsByIb[Number(position)]?.archs[0];
    return <td key={key} className={`align-middle ib-result-cell ${boundary ? 'ib-group-start' : ''}`}>
      {content}
      {delta && !running && <div className="ib-cell-comparison" title={delta.detail}>
        {delta.label && <span className={`ib-result-delta ${delta.novel ? 'ib-novel-failure' : `ib-delta-${delta.tone || 'secondary'}`}`} aria-label={delta.detail}>{delta.label}</span>}
        {delta.metrics?.map(metric => <span key={metric.key} className={`ib-result-delta ib-delta-${metric.tone}`} title={`${metric.key}: previous ${metric.previous}, current ${metric.current}; ${delta.detail}`} aria-label={`${metric.key}: ${delta.detail}`}>{metric.label}</span>)}
      </div>}
    </td>;
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

  const matrix = (
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

          >
            <thead>
              <tr>
                <th className="name-column" rowSpan={2} style={{ verticalAlign: 'middle' }}>
                  <div className="d-flex align-items-center justify-content-center h-100">
                    <span className="type-header-desktop fw-bold text-uppercase" style={{ fontSize: "var(--ui-type-label)" }}>
                      Stage
                    </span>
                    <span className="type-header-mobile fw-bold text-uppercase" style={{ fontSize: "var(--ui-type-caption)" }} />
                  </div>
                </th>

                {archsByIb.map((item, pos) => {
                  if (!item.archs?.length) return null;
                  if (!item.archs?.length) return null;

                  const flavorLabel = formatFlavorLabel(item.flavor);
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
                      className="ib-group-start"
                      colSpan={item.archs.length}
                      style={{
                        textAlign: 'center',
                        padding: '6px 2px',
                        backgroundColor: THEME.light
                      }}
                    >
                      <div className="flavor-card-wrapper">
                        {flavorLink ? (
                          <a
                            href={flavorLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ textDecoration: 'none', display: 'inline-block' }}
                            title={`Open ${releaseNameToCopy}`}
                          >
                            <div className="flavor-card" style={flavorCardStyle}>
                              {flavorLabel}
                            </div>
                          </a>
                        ) : (
                          <div className="flavor-card" style={flavorCardStyle} title={flavorLabel}>
                            {flavorLabel}
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
                          ? <span title="Patch build: reuses CMSDist tag"><FaTools size={15} /> Patch</span>
                          : <span title="Full build: dedicated CMSDist tag"><FaWrench size={15} /> Full</span>
                      )
                    : null;

                  const archStack = <ArchitectureHeader architecture={arch} icon={buildTypePrefixIcon} />;

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
                      <a href={link} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
                        {archStack}
                      </a>
                    </OverlayTrigger>
                  ) : (
                    <div>{archStack}</div>
                  );

                  return (
                    <th
                      key={`arch-${pos}-${arch}`}
                      className={archIndex === 0 ? "ib-group-start" : undefined}
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
                <tr>
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
                <tr>
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
                <tr>
                  <td className="name-column fw-semibold">
                    <a
                      href={urls.newRelVals(que, date)}
                      className="text-decoration-none d-flex align-items-center justify-content-center"
                      style={{ color: THEME.primary, height: '100%' }}
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
                <tr>
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
                <tr>
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
  return (
    <section className="ib-matrix-section" data-failures-only={failuresOnly} aria-label="Build test matrix">
      <BuildSummary counts={counts} />
      <ButtonGroup className="ib-result-filter" aria-label="Test results filter">
        <Button variant="light" active={!failuresOnly} aria-pressed={!failuresOnly} onClick={() => setFailuresOnly(false)}>All results ({Object.values(counts).reduce((sum, count) => sum + count, 0)})</Button>
        <Button variant="light" active={failuresOnly} aria-pressed={failuresOnly} onClick={() => setFailuresOnly(true)}>Failures only ({counts.danger})</Button>
      </ButtonGroup>
      {failuresOnly && counts.danger === 0 && <p className="ib-matrix-empty" role="status">No failed results in the selected architectures. Warnings remain available under All results.</p>}
      {shadeStageOutliers(matrix)}
      <details className="ib-matrix-help">
        <summary>How to read results and comparisons</summary>
      <p className="ib-matrix-legend">✓ passed · ✕ failed · ⚠ warning · ? unavailable. Build numbers count errors/warnings; Unit, RelVal and AddOn numbers count test results. Q/A is the reported duplicate-check outcome; ✕ is a failure, not “not run”. Linked cells open details. Darker failure pills indicate larger counts within the same stage, not necessarily regressions.</p>
        <p className="ib-matrix-footnote">Stage counts describe reported outcomes for selected configurations, including partial results. A pulsing inner fill means running; final comparisons are withheld until completion. Only the latest IB in an exact queue/variant sequence has comparisons. Missing or ambiguous configurations never count as zero. Newly failing means a pass-to-fail transition, not a unique failure identity. Each metric delta compares the same named count; +passes is favorable, +failures is adverse. Unchanged counts have no delta. Baselines are drawn from the complete response available to this page, before filters.</p>
      </details>
    </section>
  );
};

ComparisonTable.propTypes = {
  data: PropTypes.array.isRequired,
  releaseQue: PropTypes.string.isRequired
};

export default ComparisonTable;
