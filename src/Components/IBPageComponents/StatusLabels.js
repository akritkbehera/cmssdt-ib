import React, { Component } from "react";
import PropTypes from "prop-types";
import { config, STATUS_ENUM } from "../../config";
import { Dropdown } from "react-bootstrap";
import {
  FaTag,
  FaList,
  FaSyncAlt,
  FaCheck,
  FaExclamationTriangle,
  FaTimes,
  FaGithub,
  FaCodeBranch,
  FaBox
} from "react-icons/fa";
import { getCurrentIbTag, getDisplayName } from "../../Utils/processing";
import { UnitTestsLabel } from "./UnitTestsLabel";
import { RelvalsLabel } from "./RelvalsLabel";
import StatusDot from "../common/StatusDot";
import { sectionState } from "../../Utils/buildStatus";

const { statusLabelsConfigs } = config;

const ICON_MAP = {
  tag: <FaTag />,
  list: <FaList />,
  refresh: <FaSyncAlt className="fa-spin" />,
  success: <FaCheck />,
  warning: <FaExclamationTriangle />,
  error: <FaTimes />,
  github: <FaGithub />,
  branch: <FaCodeBranch />,
  release: <FaBox />
};

const COLOR_SCHEME = {
  primary: { bg: "#e9ecef", text: "#495057", border: "#dee2e6" },
  secondary: { bg: "#f1f3f5", text: "#495057", border: "#e9ecef" },
  success: { bg: "#e6f7e6", text: "#2c6e2c", border: "#b7e0b7" },
  danger: { bg: "#f8d7da", text: "#842029", border: "#f5c2c7" },
  warning: { bg: "#fff3cd", text: "#664d03", border: "#ffecb5" },
  info: { bg: "#d1ecf1", text: "#0c5460", border: "#bee5eb" },
  light: { bg: "#ffffff", text: "#6c757d", border: "#f8f9fa" },
  dark: { bg: "#e9ecef", text: "#343a40", border: "#dee2e6" },
  outline: { bg: "#ffffff", text: "#6c757d", border: "#dee2e6" }
};

const GLYPHICON_TO_ICON_MAP = {
  "glyphicon-ok": ICON_MAP.success,
  "glyphicon-remove": ICON_MAP.error,
  "glyphicon-warning-sign": ICON_MAP.warning,
  "glyphicon-list-alt": ICON_MAP.list,
  "glyphicon-refresh": ICON_MAP.refresh,
  "glyphicon-alert": ICON_MAP.warning
};

const HLT_GROUP_NAMES = new Set(["HLT", "HLT Phase2 Timing"]);

const STATIC_ANALYSIS_GROUP_NAMES = new Set([
  "Class Versions",
  "Code complexity metrics",
  "Flaw finder",
  "Static Analyzer",
  "SA thread unsafe modules",
  "SA thread unsafe EventSetup products",
  "Header consistency"
]);
const RUNTIME_ANALYSIS_GROUP_NAMES = new Set([ "Vtune", "RECO event loop", "Resources Piecharts"]);

class StatusLabels extends Component {
  constructor(props) {
    super(props);
    this.state = {
      IBGroup: props.IBGroup || [],
      ib: props.IBGroup?.[0] || null,
      ibGroupType: props.ibGroupType || "IB",
      showOnlyIbTag: props.showOnlyIbTag || false
    };
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    if (nextProps.IBGroup !== prevState.IBGroup) {
      return {
        IBGroup: nextProps.IBGroup || [],
        ib: nextProps.IBGroup?.[0] || null,
        ibGroupType: nextProps.ibGroupType || "IB",
        showOnlyIbTag: nextProps.showOnlyIbTag || false
      };
    }
    return null;
  }

  static resolveColors(variant, labelColor) {
    if (labelColor === "red") return COLOR_SCHEME.danger;
    if (labelColor === "orange") return COLOR_SCHEME.warning;
    if (labelColor === "green") return COLOR_SCHEME.success;
    if (labelColor === "info") return COLOR_SCHEME.info;

    return COLOR_SCHEME[variant] || COLOR_SCHEME.secondary;
  }

  static getLabelBaseStyle({ variant = "secondary", labelColor, tooltip }) {
    const colors = StatusLabels.resolveColors(variant, labelColor);

    return {
      colors,
      style: {
        backgroundColor: 'var(--ui-surface)',
        color: 'var(--ui-text)',
        fontSize: "0.85rem",
        fontWeight: "500",
        padding: "4px 11px 4px 5px",
        borderRadius: "999px",
        border: '1px solid var(--ui-border)',
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        lineHeight: 1.3,
        boxShadow: "none",
        transition: "all 0.2s ease",
        whiteSpace: "nowrap"
      }
    };
  }

  static formatLabel({ icon, name, url, labelColor, variant = "secondary", tooltip }) {
    const { colors, style } = StatusLabels.getLabelBaseStyle({
      icon,
      name,
      url,
      labelColor,
      variant,
      tooltip
    });

    const state = sectionState([{ variant, labelColor }]);
    const severity = state.status;
    const isStatus = ['success', 'danger', 'warning', 'info', 'secondary'].includes(variant) || labelColor;
    const content = (
      <>
        {isStatus ? <StatusDot status={state.status} running={state.running} size={22} /> : icon}
        <span>{name}</span>{url && <span aria-hidden="true">↗</span>}
      </>
    );

    const hoverStyle = url
      ? {
          textDecoration: "none",
          ...(labelColor ? {} : { backgroundColor: "#f8f9fa" })
        }
      : {};

    if (url) {
      return (
        <a
          key={`label-${name}-${url || "no-url"}`}
          href={url}
          className="ib-section-pill ib-tool-link"
          data-severity={severity}
          style={{ ...style, ...hoverStyle }}
          target="_blank"
          rel="noopener noreferrer"
          title={tooltip || `Open ${name} details (new tab)`}
        >
          {content}
        </a>
      );
    }

    return (
      <span key={`label-${name}-${tooltip || "no-tooltip"}`} data-severity={severity} className="ib-section-pill" style={style} title={tooltip}>
        {content}
      </span>
    );
  }

  static defaultFound(config, ib, result) {
    return {
      name: config.name,
      icon: ICON_MAP.list,
      url: config.getUrl ? config.getUrl(ib, result) : undefined,
      variant: "success",
      labelColor: "green",
      tooltip: "Found and ready"
    };
  }

  static defaultInProgress(config) {
    return {
      name: config.name,
      icon: ICON_MAP.refresh,
      variant: "info",
      labelColor: "info",
      tooltip: "In progress..."
    };
  }

  static defaultError(config) {
    return {
      name: config.name,
      icon: ICON_MAP.error,
      variant: "danger",
      labelColor: "red",
      tooltip: "Error occurred"
    };
  }

  static normalizeOutputConfig(outputConfig) {
    if (!outputConfig) return null;

    return {
      ...outputConfig,
      icon:
        outputConfig.icon ||
        GLYPHICON_TO_ICON_MAP[outputConfig.glyphicon] ||
        null
    };
  }

  static getLabelOutputConfig(configObj, ib) {
    if (!ib) return null;

    let status;
    const result = ib[configObj.key];

    if (Array.isArray(result)) {
      status = result;
    } else if (typeof result === "object" && result !== null) {
      status = result.status;
    } else {
      status = result;
    }

    if (configObj.customResultInterpretation) {
      status = configObj.customResultInterpretation(status);
    }

    let outputConfig;

    if (status === STATUS_ENUM.passed) {
      outputConfig = configObj.ifPassed
        ? configObj.ifPassed(ib, result)
        : {
            name: configObj.name,
            icon: ICON_MAP.success,
            url: configObj.getUrl ? configObj.getUrl(ib, result) : undefined,
            variant: "success",
            tooltip: "Test passed"
          };
    } else if (status === STATUS_ENUM.found) {
      outputConfig = configObj.ifFound
        ? configObj.ifFound(ib, result)
        : StatusLabels.defaultFound(configObj, ib, result);
    } else if ([STATUS_ENUM.inprogress, STATUS_ENUM.inProgress].includes(status)) {
      outputConfig = configObj.ifInProgress
        ? configObj.ifInProgress(ib, result)
        : StatusLabels.defaultInProgress(configObj);
    } else if (status === STATUS_ENUM.error) {
      outputConfig = configObj.ifError
        ? configObj.ifError(ib, result)
        : StatusLabels.defaultError(configObj);
    } else if (status === STATUS_ENUM.warning) {
      outputConfig = configObj.ifWarning
        ? configObj.ifWarning(ib, result)
        : {
            name: configObj.name,
            icon: ICON_MAP.warning,
            variant: "warning",
            labelColor: "orange",
            tooltip: "Warning: check details"
          };
    } else if (status === STATUS_ENUM.success) {
      outputConfig = configObj.ifSuccess
        ? configObj.ifSuccess(ib, result)
        : {
            name: configObj.name,
            icon: ICON_MAP.success,
            variant: "success",
            labelColor: "green",
            tooltip: "Successfully completed"
          };
    }

    return StatusLabels.normalizeOutputConfig(outputConfig);
  }

  static renderGroupedDropdown(title, items) {
    if (!items || items.length === 0) return null;
    const state = sectionState(items);
    const variant = state.status;

    return (
      <Dropdown key={`group-${title}`} className="d-inline-block me-1" data-severity={variant} autoClose="outside">
        <Dropdown.Toggle
          variant="light"
          size="sm"
          id={`dropdown-group-${title.replace(/\s+/g, "-").toLowerCase()}`}
          className="ib-section-pill"
          title={title}
        >
          <StatusDot status={state.status} running={state.running} size={22} />
          <span>{title}</span>
        </Dropdown.Toggle>

        <Dropdown.Menu style={{ minWidth: "240px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
          {items.map((item) => {

            return (
              <Dropdown.Item
                key={`${title}-${item.name}-${item.url || item.tooltip || "item"}`}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                title={item.tooltip || item.name}
                style={{
                  padding: "8px 12px",
                  fontSize: "0.85rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px"
                }}
              >
                <StatusDot {...sectionState([item])} size={16} />
                <span>{item.name}</span>
              </Dropdown.Item>
            );
          })}
        </Dropdown.Menu>
      </Dropdown>
    );
  }

  static renderIBTag(IBGroup, ibGroupType) {
    let configObj;

    switch (ibGroupType) {
      case "IB":
        configObj = {
          name: "IB Tag",
          icon: ICON_MAP.tag,
          url: "https://github.com/cms-sw/cmssw/tree/",
          variant: "primary",
          tooltip: "View this IB tag on GitHub"
        };
        break;
      case "nextIB":
        configObj = {
          name: "See Branch",
          icon: ICON_MAP.branch,
          url: "https://github.com/cms-sw/cmssw/commits/",
          variant: "secondary",
          tooltip: "View branch commits on GitHub"
        };
        break;
      case "fullBuild":
        configObj = {
          name: "Release",
          icon: ICON_MAP.release,
          url: "https://github.com/cms-sw/cmssw/releases/tag/",
          variant: "success",
          tooltip: "View release on GitHub"
        };
        break;
      default:
        return null;
    }

    if (!IBGroup || IBGroup.length === 0) return null;

    if (IBGroup.length > 1) {
      const colors = COLOR_SCHEME[configObj.variant] || COLOR_SCHEME.secondary;

      return (
        <Dropdown key={`ib-tag-${ibGroupType}`} className="d-inline-block me-1">
          <Dropdown.Toggle
            variant="light"
            size="sm"
            id={`dropdown-${ibGroupType}`}
            title={configObj.tooltip}
            style={{
              backgroundColor: colors.bg,
              borderColor: colors.border,
              color: colors.text,
              fontWeight: "500",
              padding: "4px 10px",
              fontSize: "0.85rem",
              boxShadow: "none"
            }}
          >
            <span className="me-1" style={{ color: colors.text }}>{configObj.icon}</span>
            <span style={{ color: colors.text }}>{configObj.name}</span>
          </Dropdown.Toggle>

          <Dropdown.Menu style={{ minWidth: "200px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
            {IBGroup.map((ib) => {
              const tag = getCurrentIbTag(ib);
              const displayName = getDisplayName(ib.release_queue) || tag;
              return (
                <Dropdown.Item
                  key={`ib-${tag}`}
                  href={configObj.url + tag}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`View ${displayName}`}
                  style={{ padding: "6px 12px", fontSize: "0.85rem" }}
                >
                  <span className="me-2" style={{ color: "black" }}>{configObj.icon}</span>
                  <span>{displayName}</span>
                </Dropdown.Item>
              );
            })}
          </Dropdown.Menu>
        </Dropdown>
      );
    }

    return StatusLabels.formatLabel({
      name: configObj.name,
      icon: configObj.icon,
      url: configObj.url + getCurrentIbTag(IBGroup[0]),
      variant: configObj.variant,
      tooltip: configObj.tooltip
    });
  }

  render() {
    const { IBGroup, showOnlyIbTag, ibGroupType, ib } = this.state;

    if (showOnlyIbTag) {
      return null;
    }

    const menuData = [];
    const generatedLabelConfigs = [];

    if (ibGroupType !== "IB") {
      const ibTag = StatusLabels.renderIBTag(IBGroup, ibGroupType);
      if (ibTag) menuData.push(ibTag);
    }

    if (ib) {
      if (ib.gpu_data?.relvals && Object.keys(ib.gpu_data.relvals).length > 0) {
        menuData.push(
          <RelvalsLabel key="gpu-relvals" tests={ib.gpu_data.relvals} type_name="gpu" />
        );
      }

      if (ib.gpu_data?.qa && Object.keys(ib.gpu_data.qa).length > 0) {
        menuData.push(
          <UnitTestsLabel key="gpu-qa" tests={ib.gpu_data.qa} type_name="gpu" />
        );
      }

      const relvals = ib.other_data?.relvals || {};
      const rntupleRelvals = Object.fromEntries(
        Object.entries(relvals)
          .filter(([k]) => k.startsWith("rntuple/"))
          .map(([k, v]) => [k.replace(/^rntuple\//, ""), v])
      );

      if (Object.keys(rntupleRelvals).length > 0) {
        menuData.push(
          <RelvalsLabel key="rntuple-relvals" tests={rntupleRelvals} type_name="rntuple" />
        );
      }
    }

    if (statusLabelsConfigs && Array.isArray(statusLabelsConfigs)) {
      statusLabelsConfigs.forEach((conf) => {
        const labelConfig = StatusLabels.getLabelOutputConfig(conf, ib);
        if (labelConfig) {
          generatedLabelConfigs.push(labelConfig);
        }
      });
    }

    const hltItems = generatedLabelConfigs.filter((item) => HLT_GROUP_NAMES.has(item.name));
    const staticAnalysisItems = generatedLabelConfigs.filter((item) => STATIC_ANALYSIS_GROUP_NAMES.has(item.name));
    const runtimeAnalysisItems = generatedLabelConfigs.filter((item) => RUNTIME_ANALYSIS_GROUP_NAMES.has(item.name));
    const otherItems = generatedLabelConfigs.filter((item) =>
      !HLT_GROUP_NAMES.has(item.name) &&
      !STATIC_ANALYSIS_GROUP_NAMES.has(item.name) &&
      !RUNTIME_ANALYSIS_GROUP_NAMES.has(item.name)
    );

    if (hltItems.length > 0) {
      menuData.push(StatusLabels.renderGroupedDropdown("HLT", hltItems));
    }
    if (staticAnalysisItems.length > 0) {
      menuData.push(StatusLabels.renderGroupedDropdown("Static Analysis", staticAnalysisItems));
    }
    if (runtimeAnalysisItems.length > 0) {
      menuData.push(StatusLabels.renderGroupedDropdown("Run time analysis", runtimeAnalysisItems));
    }
    otherItems.forEach((item) => {
      menuData.push(StatusLabels.formatLabel(item));
    });

    const severityOrder = { danger: 0, warning: 1, info: 2, success: 3, secondary: 4 };
    const validMenuData = menuData.filter((item) => item != null).sort((a, b) =>
      (severityOrder[a.props?.['data-severity']] ?? 5) - (severityOrder[b.props?.['data-severity']] ?? 5));

    return (
     <div className="ib-section-controls d-flex flex-wrap align-items-center">
        {validMenuData}
    </div>
    );
  }
}

StatusLabels.propTypes = {
  IBGroup: PropTypes.array,
  ibGroupType: PropTypes.oneOf(["IB", "nextIB", "fullBuild"]),
  showOnlyIbTag: PropTypes.bool
};

StatusLabels.defaultProps = {
  IBGroup: [],
  ibGroupType: "IB",
  showOnlyIbTag: false
};

export default StatusLabels;
