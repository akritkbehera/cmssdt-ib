import React, { Component } from "react";
import { GoGitPullRequest } from "react-icons/go";
import { RiShareForwardLine } from "react-icons/ri";
import PropTypes from "prop-types";
import {
  Col,
  Nav,
  NavDropdown,
  Row,
  Tab,
  Card,
  Badge,
  Collapse,
  Button,
  Modal,
  Spinner,
  Alert,
  OverlayTrigger,
  Popover
} from "react-bootstrap";
import {
  getCurrentIbTag,
  getDisplayName,
  getPreviousIbTag
} from "../../Utils/processing";
import { config } from "../../config";
import { getSingleFile } from "../../Utils/ajax";
import {
  FaCodeBranch,
  FaGitAlt,
  FaGithub,
  FaUser,
  FaCalendarAlt,
  FaArrowRight,
  FaChevronDown,
  FaChevronUp,
  FaGripLines,
  FaCheckCircle,
  FaInfoCircle,
  FaTag,
  FaSearch,
  FaEye
} from "react-icons/fa";
import { FaCodeCompare } from "react-icons/fa6";

const { githubCompareTags, githubRepo, githubRepoTag } = config.urls;

/** TTLs */
const LABELS_MEMORY_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const PR_MEMORY_TTL_MS = 15 * 60 * 1000; // 15 minutes

let globalCmsswLabelsCache = null; 
let globalCmsswLabelsPromise = null;

const globalPrJsonCache = {}; 
const globalPrJsonPromises = {};

function isFreshCache(entry, ttlMs) {
  if (!entry || !entry.cachedAt) return false;
  return Date.now() - entry.cachedAt < ttlMs;
}

const THEME = {
  primary: "#2563eb",
  primaryHover: "#1d4ed8",
  surface: "#ffffff",
  surfaceMuted: "#f8fafc",
  surfaceMuted2: "#f1f5f9",
  border: "#e2e8f0",
  borderDark: "#cbd5e1",
  text: {
    primary: "#0f172a",
    secondary: "#475569",
    muted: "#64748b"
  },
  success: "#16a34a",
  warning: "#d97706",
  danger: "#dc2626"
};

const styles = {
  card: {
    border: `1px solid ${THEME.border}`,
    borderRadius: "12px",
    background: THEME.surface,
    boxShadow: "0 6px 18px rgba(15, 23, 42, 0.06)",
    overflow: "visible"
  },
  cardHeader: {
    backgroundColor: THEME.surfaceMuted,
    borderBottom: `1px solid ${THEME.border}`,
    padding: "0.75rem 1.25rem",
    fontWeight: 700,
    color: THEME.text.primary,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.4rem",
    cursor: "pointer",
    userSelect: "20px"
  },
  cardHeaderContent: {
    display: "flex",
    alignItems: "center",
    gap: "0.45rem",
    flexWrap: "wrap"
  },
  cardBody: {
    padding: 0,
    backgroundColor: THEME.surface
  },
  expandButton: {
    backgroundColor: THEME.surface,
    border: `1px solid ${THEME.border}`,
    borderRadius: "999px",
    padding: "0.14rem 0.5rem",
    fontSize: "0.7rem",
    color: THEME.text.secondary,
    display: "flex",
    alignItems: "center",
    gap: "0.28rem",
     lineHeight: 1
  },
  comparisonAlert: {
    backgroundColor: THEME.surfaceMuted,
    border: `1px solid ${THEME.border}`,
    borderRadius: "10px",
    padding: "0.75rem 1rem",
    marginBottom: "1rem",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "0.5rem",
    fontSize: "0.9rem"
  },
  tag: {
    backgroundColor: THEME.surface,
    border: `1px solid ${THEME.border}`,
    borderRadius: "8px",
    padding: "0.15rem 0.5rem",
    fontFamily: "monospace",
    fontSize: "0.8rem",
    color: THEME.text.primary
  },
  headerPillsWrap: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    marginLeft: "10px"
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "0.22rem 0.6rem",
    borderRadius: "999px",
    border: `1px solid ${THEME.border}`,
    background: THEME.surface,
    color: THEME.text.secondary,
    fontSize: "0.74rem",
    fontWeight: 900,
    letterSpacing: "0.2px",
    whiteSpace: "nowrap",
    lineHeight: 1
  },
  navTabsWrap: {
    background: THEME.surfaceMuted,
    borderBottom: `1px solid ${THEME.border}`,
    padding: "0.2rem 0.50rem",
    gap: "0.25rem"
  },
  tabLink: (isActive) => ({
    backgroundColor: isActive ? THEME.surface : "transparent",
    color: THEME.text.primary,
    border: `1px solid ${isActive ? THEME.borderDark : "transparent"}`,
    borderBottom: isActive
      ? `1px solid ${THEME.surface}`
      : `1px solid transparent`,
    borderRadius: "7px 7px 0 0",
    padding: "0.45rem 0.8rem",
    fontWeight: 800,
    fontSize: "0.75rem",
    transition: "background-color 0.15s ease, border-color 0.15s ease"
  }),
  tabPane: {
    padding: "1rem",
    background: THEME.surface
  },
  badge: {
    padding: "0.22rem 0.55rem",
    borderRadius: "999px",
    fontSize: "0.72rem",
    fontWeight: 800,
    letterSpacing: "0.02em"
  },
  cmsdistSearchWrap: {
    padding: "10px 10px 8px 10px",
    position: "sticky",
    top: 0,
    background: THEME.surface,
    borderBottom: `1px solid ${THEME.border}`,
    zIndex: 1
  },
  cmsdistSearchInputWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    padding: "6px 10px",
    background: THEME.surfaceMuted
  },
  cmsdistSearchInput: {
    width: "100%",
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: "0.82rem",
    color: THEME.text.primary
  },
  cmsdistItem: {
    padding: "0.55rem 1rem",
    fontSize: "0.85rem",
    backgroundColor: "transparent",
    transition: "background 0.15s ease"
  },
  prRowWrap: {
    padding: "6px 10px",
    transition:
      "background-color 0.12s ease, border-color 0.12s ease",
  },
  prRowTop: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    minWidth: 0
  },
  prRowMeta: {
    
    fontSize: "0.78rem"
   
  },
  prRowTitle: {
    color: THEME.text.primary,
    fontSize: "0.86rem",
    fontWeight: 700,
    lineHeight: 1.35,
    minWidth: 0
  },
  prNumberLink: {
    color: THEME.primary,
    fontWeight: 900,
    textDecoration: "none",
    fontSize: "0.84rem",
    whiteSpace: "nowrap"
  },
  prActionBtn: {
    borderRadius: "999px",
    padding: "0.22rem 0.65rem",
    fontSize: "0.74rem",
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    textDecoration: "none",
    whiteSpace: "nowrap"
  },
  labelPill: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: "999px",
    border: `1px solid ${THEME.border}`,
    background: THEME.surfaceMuted,
    color: THEME.text.secondary,
    fontSize: "0.68rem",
    fontWeight: 800,
    lineHeight: 1.2
  },
  previewStatCard: {
    background: THEME.surfaceMuted,
    border: `1px solid ${THEME.border}`,
    borderRadius: "12px",
    padding: "8px",
    textAlign: "center",
    height: "100%"
  },
  compactDropdownToggle: {
    backgroundColor: THEME.surface,
    color: THEME.text.primary,
    border: `1px solid ${THEME.borderDark}`,
    borderBottom: `1px solid ${THEME.surface}`,
    borderRadius: "7px 7px 0 0",
    padding: "0.32rem 0.65rem",
    fontWeight: 800,
    fontSize: "0.75rem",
    minHeight: "30px",
    display: "flex",
    alignItems: "center"
  }
};

function truncateTitle(text, max = 90) {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function getSeriesKeyFromTag(tag) {
  if (!tag) return null;
  const match = String(tag).match(/^CMSSW_(\d+)_(\d+)/);
  if (!match) return null;
  return `CMSSW_${match[1]}_${match[2]}`;
}

function getPrJsonUrl(seriesKey) {
  if (!seriesKey) return null;
  return `${config.urls.publicDataDir}/prs/${seriesKey}.json`;
}

function getCmsswLabelsUrl() {
  return `${config.urls.publicDataDir}/cmssw_labels.json`;
}

function getRepoKey(repo) {
  if (repo === "cms-sw/cmssw") return "cmssw";
  if (repo === "cms-sw/cmsdist") return "cmsdist";
  return null;
}

function getPrHtmlUrl(repo, prNumber) {
  return `https://github.com/${repo}/pull/${prNumber}`;
}

function normalizeTimestamp(value) {
  if (!value) return null;

  if (typeof value === "number") {
    return value < 1000000000000 ? value * 1000 : value;
  }

  if (typeof value === "string") {
    if (/^\d+$/.test(value)) {
      const numeric = Number(value);
      return numeric < 1000000000000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return null;
}

function formatUnixOrDateCompact(value) {
  const ts = normalizeTimestamp(value);
  if (!ts) return null;

  const date = new Date(ts);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateLong(value) {
  const ts = normalizeTimestamp(value);
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatRelativeOrDate(value) {
  const ts = normalizeTimestamp(value);
  if (!ts) return "";

  const now = Date.now();
  const diffDays = Math.ceil(Math.abs(now - ts) / (1000 * 60 * 60 * 24));

  if (diffDays < 1) return "today";
  if (diffDays < 30) return `${diffDays} days ago`;

  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function normalizeLabelValue(label) {
  if (typeof label === "string") return label;
  if (label && typeof label === "object" && label.name) return label.name;
  return "";
}

function normalizeHexColor(color) {
  if (!color) return null;
  const value = String(color).trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(value)) {
    return `#${value}`;
  }
  return null;
}

function getLabelStyleFromMap(labelName, cmsswLabelsMap) {
  const color = normalizeHexColor(cmsswLabelsMap?.[labelName]);
  if (!color) return null;

  return {
    background: color,
    color: "#ffffff",
    border: `1px solid ${color}`
  };
}

function enrichMergedPrs(mergedPrs, repo, prJsonData) {
  if (!Array.isArray(mergedPrs)) return [];

  const repoKey = getRepoKey(repo);
  const repoPrMap =
    prJsonData && repoKey && prJsonData[repoKey] ? prJsonData[repoKey] : {};

  return mergedPrs.map((pr) => {
    const prNumber = String(pr?.number ?? "");
    const jsonPr = repoPrMap[prNumber] || {};

    const labels =
      Array.isArray(jsonPr.labels) && jsonPr.labels.length > 0
        ? jsonPr.labels
        : Array.isArray(pr.labels)
          ? pr.labels
          : [];

    return {
      ...pr,
      ...jsonPr,
      number: jsonPr.number ?? pr.number,
      title: jsonPr.title ?? pr.title ?? "",
      body: jsonPr.body ?? pr.body ?? "",
      state: jsonPr.state ?? pr.state ?? "",
      merged_at: jsonPr.merged_at ?? pr.merged_at ?? null,
      created_at: jsonPr.created_at ?? pr.created_at ?? null,
      updated_at: jsonPr.updated_at ?? pr.updated_at ?? null,
      commits: jsonPr.commits ?? pr.commits ?? 0,
      comments: jsonPr.comments ?? pr.comments ?? 0,
      review_comments: jsonPr.review_comments ?? pr.review_comments ?? 0,
      changed_files: jsonPr.changed_files ?? pr.changed_files ?? 0,
      additions: jsonPr.additions ?? pr.additions ?? 0,
      deletions: jsonPr.deletions ?? pr.deletions ?? 0,
      branch: jsonPr.branch ?? pr.branch ?? "",
      merge_commit_sha: jsonPr.merge_commit_sha ?? pr.merge_commit_sha ?? "",
      milestone: jsonPr.milestone ?? pr.milestone ?? "",
      user: jsonPr.user ?? pr.user ?? "",
      author: jsonPr.author ?? pr.author ?? "",
      author_login: pr.author_login || jsonPr.user || jsonPr.author || "",
      labels,
      url:
        pr.url ||
        jsonPr.html_url ||
        getPrHtmlUrl(repo, jsonPr.number ?? pr.number)
    };
  });
}

function isFromMergedCommit(pr) {
  if (pr.from_merge_commit === true) {
    return (
       <span
        title="Forwad port"
        style={{
          width: "22px",
          height: "22px",
          borderRadius: "999px",
          background: "#0ea5e9",
          color: "#ffffff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginLeft: "6px",
          boxShadow: "0 2px 6px rgba(14, 165, 233, 0.25)",
          flexShrink: 0
        }}
      >
        <RiShareForwardLine size={13} />
      </span>
    );
  }
  return null;
}

function hasPrs(prList) {
  return Array.isArray(prList) && prList.length > 0;
}

function renderComparisonLink(repo, startTag, endTag) {
  const repoName = repo === "cms-sw/cmssw" ? "CMSSW" : "CMSDIST";
  const repoUrl = githubRepo(repo);
  const compareUrl = githubCompareTags(repo, startTag, endTag);

  return (
    <div style={styles.comparisonAlert}>
      <FaCodeBranch style={{ color: THEME.text.muted }} size={14} />
      <span style={{ color: THEME.text.secondary, fontSize: "0.85rem" }}>
        Comparing
      </span>
      <a
        href={repoUrl}
        className="text-decoration-none fw-semibold"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: THEME.primary, fontSize: "0.85rem" }}
      >
        {repoName}
      </a>
      <div className="d-flex align-items-center gap-1 flex-wrap">
        <code style={styles.tag}>{startTag}</code>
        <FaArrowRight size={10} style={{ color: THEME.text.muted }} />
        <code style={styles.tag}>{endTag}</code>
      </div>
      <a
        href={compareUrl}
        className="btn btn-sm ms-auto"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          backgroundColor: THEME.primary,
          color: "#fff",
          border: "none",
          borderRadius: "10px",
          padding: "0.25rem 0.8rem",
          fontSize: "0.75rem",
          fontWeight: 800,
          textDecoration: "none"
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.backgroundColor = THEME.surfaceMuted2)
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.backgroundColor = "transparent")
        }
      >
        Diff
      </a>
    </div>
  );
}

const PRLabels = ({ pr, cmsswLabelsMap }) => {
  const labels = Array.isArray(pr.labels) ? pr.labels : [];
  if (labels.length === 0 || !cmsswLabelsMap) return null;

  const getPriority = (name) => {
    if (name.endsWith("-approved")) return 3;
    if (name.endsWith("-pending")) return 2;
    if (name.endsWith("-rejected")) return 1;
    return 0;
  };

  const getBaseName = (name) =>
    name
      .replace(/-approved$/i, "")
      .replace(/-pending$/i, "")
      .replace(/-rejected$/i, "");

  const validLabels = labels
    .map((label) => normalizeLabelValue(label))
    .filter((name) => name && cmsswLabelsMap[name]);

  if (validLabels.length === 0) return null;

  const grouped = {};
  validLabels.forEach((labelName) => {
    const base = getBaseName(labelName);
    const priority = getPriority(labelName);

    if (!grouped[base] || priority > grouped[base].priority) {
      grouped[base] = {
        originalName: labelName,
        baseName: base,
        priority
      };
    }
  });

  const finalLabels = Object.values(grouped).slice(0, 8);

  return (
    <>
      {finalLabels.map((label) => {
        const colorHex = cmsswLabelsMap[label.originalName];
        const color = colorHex ? `#${colorHex}` : null;
        if (!color) return null;

        return (
          <span
            key={label.baseName}
            title={label.originalName}
            style={{
              ...styles.labelPill,
              background: color,
              color: "#ffffff",
              border: `1px solid ${color}`
            }}
          >
            {label.baseName}
          </span>
        );
      })}
    </>
  );
};

const GitHubPreviewContent = ({
  pr,
  cmsswLabelsMap,
  fixedHeight = false
}) => {
  const stateStr = pr.state || "closed";
  const isMerged =
    pr.merged_at !== null &&
    pr.merged_at !== undefined &&
    pr.merged_at !== "";
  const isDraft = Boolean(pr.draft);

  const additions = pr.additions || 0;
  const deletions = pr.deletions || 0;
  const changedFiles = pr.changed_files || 0;
  const commitCount = pr.commits || 0;
  const commentCount = pr.comments || 0;
  const reviewCommentCount = pr.review_comments || 0;
  const totalComments = commentCount + reviewCommentCount;
  const authorName = pr.user || pr.author || pr.author_login || "unknown";
  const releaseNotesCount = Array.isArray(pr["release-notes"])
    ? pr["release-notes"].length
    : 0;

  const getStatusBadge = () => {
    if (isDraft) return <Badge bg="secondary">Draft</Badge>;
    if (isMerged)
      return <Badge style={{ backgroundColor: "#64748b" }}>Merged</Badge>;
    if (stateStr === "open") return <Badge bg="success">Open</Badge>;
    if (stateStr === "closed") return <Badge bg="danger">Closed</Badge>;
    return null;
  };

  const labels = Array.isArray(pr.labels) ? pr.labels : [];
  const getPriority = (name) => {
    if (name.endsWith("-approved")) return 3;
    if (name.endsWith("-pending")) return 2;
    if (name.endsWith("-rejected")) return 1;
    return 0;
  };
  const getBaseName = (name) =>
    name
      .replace(/-approved$/i, "")
      .replace(/-pending$/i, "")
      .replace(/-rejected$/i, "");

  const validLabels = labels
    .map((label) => normalizeLabelValue(label))
    .filter((name) => name && cmsswLabelsMap && cmsswLabelsMap[name]);

  const grouped = {};
  validLabels.forEach((labelName) => {
    const base = getBaseName(labelName);
    const priority = getPriority(labelName);

    if (!grouped[base] || priority > grouped[base].priority) {
      grouped[base] = {
        originalName: labelName,
        baseName: base,
        priority
      };
    }
  });

  const finalLabels = Object.values(grouped);

  return (
    <div
      style={
        fixedHeight
          ? {
              height: "100%",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              overflow: "hidden"
            }
          : undefined
      }
    >
      <div
        className="mb-3 p-2 rounded-3"
        style={{
          background: THEME.surfaceMuted,
          border: `1px solid ${THEME.border}`,
          fontSize: "1.05rem",
          fontWeight: 800,
          flexShrink: 0
        }}
      >
        {pr.title}
      </div>

      <div
        className="d-flex flex-wrap align-items-center gap-3 mb-3 text-muted small"
        style={{ flexShrink: 0 }}
      >
        <span className="d-flex align-items-center">
          <FaUser className="me-1" size={12} />
          <span className="fw-semibold" style={{ color: THEME.text.primary }}>
            {authorName}
          </span>
        </span>

        {pr.created_at && (
          <span
            className="d-flex align-items-center"
            title={formatDateLong(pr.created_at)}
          >
            <FaCalendarAlt className="me-1" size={12} />
            opened{" "}
            <span
              className="fw-semibold ms-1"
              style={{ color: THEME.text.primary }}
            >
              {formatRelativeOrDate(pr.created_at)}
            </span>
          </span>
        )}

        {pr.merged_at && (
          <span
            className="d-flex align-items-center"
            title={formatDateLong(pr.merged_at)}
          >
            <FaCheckCircle
              className="me-1"
              size={12}
              style={{ color: THEME.success }}
            />
            merged{" "}
            <span
              className="fw-semibold ms-1"
              style={{ color: THEME.text.primary }}
            >
              {formatRelativeOrDate(pr.merged_at)}
            </span>
          </span>
        )}

        <span>{getStatusBadge()}</span>
      </div>

      {finalLabels.length > 0 && (
        <div className="mb-3 d-flex flex-wrap gap-2" style={{ flexShrink: 0 }}>
          {finalLabels.map((label) => {
            const labelStyle = getLabelStyleFromMap(
              label.originalName,
              cmsswLabelsMap
            );
            if (!labelStyle) return null;

            return (
              <span
                key={label.baseName}
                title={label.originalName}
                style={{
                  ...styles.labelPill,
                  background: labelStyle.background,
                  color: labelStyle.color,
                  border: labelStyle.border
                }}
              >
                {label.baseName}
              </span>
            );
          })}
        </div>
      )}

      <div className="row g-2 mb-3" style={{ flexShrink: 0 }}>
        <div className="col-6 col-md-3">
          <div style={styles.previewStatCard}>
            <div className="small text-muted">Commits</div>
            <div className="fw-bold" style={{ color: THEME.text.primary }}>
              {commitCount}
            </div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div style={styles.previewStatCard}>
            <div className="small text-muted">Files</div>
            <div className="fw-bold" style={{ color: THEME.text.primary }}>
              {changedFiles}
            </div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div style={styles.previewStatCard}>
            <div className="small text-muted">Comments</div>
            <div className="fw-bold" style={{ color: THEME.text.primary }}>
              {totalComments}
            </div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div style={styles.previewStatCard}>
            <div className="small text-muted">Changes</div>
            <div className="d-flex justify-content-center gap-1">
              <span className="fw-bold" style={{ color: THEME.success }}>
                +{additions}
              </span>
              <span className="fw-bold" style={{ color: THEME.danger }}>
                -{deletions}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-2 mb-3" style={{ flexShrink: 0 }}>
        <div className="col-12 col-md-6">
          <div style={{ ...styles.previewStatCard, textAlign: "left" }}>
            <div className="small text-muted mb-1">Branch</div>
            <div
              className="fw-semibold"
              style={{
                color: THEME.text.primary,
                wordBreak: "break-word",
                overflowWrap: "anywhere"
              }}
            >
              {pr.branch || "—"}
            </div>
          </div>
        </div>

        <div className="col-12 col-md-6">
          <div style={{ ...styles.previewStatCard, textAlign: "left" }}>
            <div className="small text-muted mb-1">Merge commit</div>
            <div
              className="fw-semibold"
              style={{
                color: THEME.text.primary,
                wordBreak: "break-word",
                overflowWrap: "anywhere"
              }}
            >
              {pr.merge_commit_sha ? String(pr.merge_commit_sha).slice(0, 16) : "—"}
            </div>
          </div>
        </div>

        <div className="col-12 col-md-4">
          <div style={{ ...styles.previewStatCard, textAlign: "left" }}>
            <div className="small text-muted mb-1">Milestone</div>
            <div
              className="fw-semibold"
              style={{
                color: THEME.text.primary,
                wordBreak: "break-word",
                overflowWrap: "anywhere"
              }}
            >
              {pr.milestone || "—"}
            </div>
          </div>
        </div>

        <div className="col-12 col-md-4">
          <div style={{ ...styles.previewStatCard, textAlign: "left" }}>
            <div className="small text-muted mb-1">Updated</div>
            <div
              className="fw-semibold"
              style={{
                color: THEME.text.primary,
                wordBreak: "break-word",
                overflowWrap: "anywhere"
              }}
            >
              {pr.updated_at ? formatDateLong(pr.updated_at) : "—"}
            </div>
          </div>
        </div>

        <div className="col-12 col-md-4">
          <div style={{ ...styles.previewStatCard, textAlign: "left" }}>
            <div className="small text-muted mb-1">Release notes</div>
            <div className="fw-semibold" style={{ color: THEME.text.primary }}>
              {releaseNotesCount}
            </div>
          </div>
        </div>
      </div>

      {pr.merge_commit_sha && (
        <div
          className="d-flex align-items-center gap-2 mb-3 p-2 rounded-3"
          style={{
            background: THEME.surfaceMuted,
            border: `1px solid ${THEME.border}`,
            flexShrink: 0
          }}
        >
          <FaTag className="text-secondary" size={12} />
          <span className="small text-muted">Merge SHA</span>
          <code
            className="bg-white px-2 py-1 rounded small"
            style={{
              border: `1px solid ${THEME.border}`,
              wordBreak: "break-word",
              overflowWrap: "anywhere"
            }}
          >
            {pr.merge_commit_sha}
          </code>
        </div>
      )}

      <div
        className="mb-3"
        style={
          fixedHeight
            ? {
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden"
              }
            : undefined
        }
      >
        <div className="d-flex align-items-center gap-2 mb-1" style={{ flexShrink: 0 }}>
          <FaInfoCircle style={{ color: THEME.primary }} size={14} />
          <span className="small fw-semibold">Description</span>
        </div>

        <div
          className="small rounded-3 p-2"
          style={{
            background: THEME.surface,
            border: `1px solid ${THEME.border}`,
            flex: fixedHeight ? 1 : "unset",
            minHeight: fixedHeight ? 0 : "120px",
            maxHeight: fixedHeight ? "100%" : "220px",
            overflowY: "auto",
            overflowX: "hidden",
            color: THEME.text.secondary,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflowWrap: "anywhere"
          }}
        >
          {pr.body || "No description available"}
        </div>
      </div>

      <div
        className="d-flex gap-2"
        style={{
          marginTop: "12px",
          flexShrink: 0
        }}
      >
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-grow-1 btn btn-sm btn-primary"
        >
          <FaGithub className="me-1" /> View Full PR
        </a>
      </div>
    </div>
  );
};

function renderCommits(
  mergedPrs,
  previousIBTag,
  repo,
  isExpanded,
  prJsonData,
  cmsswLabelsMap,
  onOpenPreview,
  previewLoadingPrNumber,
  seriesKey,
  targetPrNumber,
) {
  if (!isExpanded) return null;

  const enrichedPrs = enrichMergedPrs(mergedPrs, repo, prJsonData);

  if (!enrichedPrs || enrichedPrs.length === 0) {
   return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "14px",
          padding: "8px 14px",
          color: THEME.text.muted,
          minHeight: "38px",
          borderTop: `1px solid ${THEME.border}`,
          borderBottom: `1px solid ${THEME.border}`,
          overflowX: "auto",
          whiteSpace: "nowrap"
        }}
      >
        <GoGitPullRequest
          size={16}
          style={{
            opacity: 0.5,
            flexShrink: 0
          }}
        />

        <span
          style={{
            fontSize: "0.84rem",
            fontWeight: 800,
            color: THEME.text.secondary,
            flexShrink: 0
          }}
        >
          No pull requests found
        </span>

        <span
          style={{
            color: THEME.borderDark,
            fontWeight: 700,
            flexShrink: 0
          }}
        >
          |
        </span>

        <span
          style={{
            fontSize: "0.78rem",
            color: THEME.text.muted,
            flexShrink: 0
          }}
        >
          Compared to
        </span>

        <a
          href={githubRepoTag(repo, previousIBTag)}
          className="text-decoration-none"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flexShrink: 0
          }}
        >
          <code
            style={{
              ...styles.tag,
              fontSize: "0.70rem",
              padding: "2px 7px",
              margin: 0
            }}
          >
            {previousIBTag}
          </code>
        </a>
      </div>
    );
    
  }

  const sortedPrs = [...enrichedPrs].sort((a, b) => (b.number || 0) - (a.number || 0));

  return (
    <div className="mt-2">
      <div className="d-flex align-items-center justify-content-between mb-2 px-2">
        <h6
          className="d-flex align-items-center m-0"
          style={{
            color: THEME.text.primary,
            fontWeight: 900,
            fontSize: "0.95rem"
          }}
        >
          {/* <FaGitAlt className="me-2" style={{ color: THEME.primary }} size={14} />
          Pull Requests
          <span style={{ ...styles.pill, marginLeft: 8 }}>{sortedPrs.length} total</span> */}
        </h6>
      </div>
      <div className="px-2 pb-2">
        {sortedPrs.map((pr, index) => {
          const baseBg = index % 2 === 0 ? THEME.surface : THEME.surfaceMuted;
          const isMatchedPr =
            targetPrNumber &&
            String(pr.number) === String(targetPrNumber);
          const isThisPreviewLoading =
            previewLoadingPrNumber !== null &&
            String(previewLoadingPrNumber) === String(pr.number);

          return (
            <div
              key={`${repo}-pr-${pr.number}`}
              data-target-pr={isMatchedPr ? String(pr.number) : undefined}
              style={{
                ...styles.prRowWrap,
                backgroundColor: isMatchedPr ? "#dbeafe" : baseBg,
                borderLeft: isMatchedPr
                  ? "4px solid #2563eb"
                  : "4px solid transparent",
                borderRadius: "0px",
                marginBottom: "0px",
                borderBottom: `1px solid ${THEME.border}`,
                boxShadow: isMatchedPr
                  ? "0 0 0 2px rgba(37, 99, 235, 0.18)"
                  : "none"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = isMatchedPr
                  ? "#bfdbfe"
                  : THEME.surfaceMuted2;
                e.currentTarget.style.borderColor = THEME.borderDark;
                e.currentTarget.style.boxShadow = isMatchedPr
                  ? "0 0 0 2px rgba(37, 99, 235, 0.25)"
                  : "0 8px 18px rgba(15, 23, 42, 0.06)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = isMatchedPr
                  ? "#dbeafe"
                  : baseBg;
                e.currentTarget.style.borderColor = THEME.border;
                e.currentTarget.style.boxShadow = isMatchedPr
                  ? "0 0 0 2px rgba(37, 99, 235, 0.18)"
                  : "none";
              }}
            >
              <div className="d-flex flex-column gap-2">
                <div className="d-flex align-items-start justify-content-between gap-2 flex-wrap">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={styles.prRowTop}>
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.prNumberLink}
                        onClick={(e) => e.stopPropagation()}
                      >
                        #{pr.number}
                      </a>

                      <span style={styles.prRowMeta}>
                        from{" "}
                        <strong style={{ color: THEME.text.secondary }}>
                          {pr.author_login || pr.user || pr.author}
                        </strong>
                        :
                      </span>

                      <span style={styles.prRowTitle} title={pr.title}>
                        {truncateTitle(pr.title, 90)}
                      </span>

                      {isFromMergedCommit(pr)}

                      <span className="d-flex flex-wrap align-items-center gap-1 ms-2">
                        <PRLabels pr={pr} cmsswLabelsMap={cmsswLabelsMap} />
                      </span>

                      {pr.created_at && (
                        <span style={styles.prRowMeta}>
                          <FaCalendarAlt size={11} className="me-1" />
                          {formatUnixOrDateCompact(pr.created_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="d-flex align-items-center gap-2 flex-shrink-0">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      style={styles.prActionBtn}
                      disabled={isThisPreviewLoading}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenPreview(pr, repo, seriesKey);
                      }}
                    >
                      {isThisPreviewLoading ? (
                        <>
                          <Spinner animation="border" size="sm" />
                          Loading
                        </>
                      ) : (
                        <>
                          <FaEye size={12} />
                          Preview
                        </>
                      )}
                    </Button>

                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        ...styles.prActionBtn,
                        border: `1px solid ${THEME.border}`,
                        background: THEME.surface,
                        color: THEME.text.secondary
                      }}
                      onClick={(e) => e.stopPropagation()}
                      title="Open on GitHub"
                    >
                      <FaGithub size={13} />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

class Commits extends Component {
  constructor(props) {
    super(props);
    this.toggleLoaderTimeout = null;
    this._isMounted = false;
    this.visibilityHandler = null;

    this.state = {
      commitPanelProps: props.commitPanelProps || {},
      ibComparison: props.data || [],
      expanded:
        props.expandAllCommits ?? props.commitPanelProps?.defaultExpanded ?? false,
      activeTabKey: "cmssw-0",
      cmsdistSearch: "",
      prJsonCache: {},
      prJsonLoading: {},
      prJsonErrors: {},
      cmsswLabelsMap: isFreshCache(globalCmsswLabelsCache, LABELS_MEMORY_TTL_MS)
        ? globalCmsswLabelsCache.data
        : {},
      cmsswLabelsLoading: false,
      cmsswLabelsError: null,
      previewPr: null,
      previewLoading: false,
      previewError: null,
      previewLoadingPrNumber: null,
      toggleLoading: false
    };
  }

static getDerivedStateFromProps(nextProps, prevState) {
  if (nextProps.data !== prevState.ibComparison) {
    return {
      ibComparison: nextProps.data || [],
      commitPanelProps: nextProps.commitPanelProps || {},
      activeTabKey: prevState.activeTabKey || "cmssw-0",
      cmsdistSearch: prevState.cmsdistSearch
    };
  }
  return null;
}

  componentDidMount() {
    this._isMounted = true;
    this.loadCmsswLabels();
    this.loadPrJsonForActiveTab(this.state.activeTabKey);

    this.visibilityHandler = () => {
      if (document.visibilityState === "visible") {
        this.loadCmsswLabels();
        this.loadPrJsonForActiveTab(this.state.activeTabKey);
      }
    };

    document.addEventListener("visibilitychange", this.visibilityHandler);
    this.activateTargetPr();
  }

 componentDidUpdate(prevProps) {
  if (prevProps.data !== this.props.data && this.state.expanded) {
    this.loadPrJsonForActiveTab(this.state.activeTabKey);
  }

  if (prevProps.expandAllCommits !== this.props.expandAllCommits) {
    this.startToggleLoader();
    this.setState({ expanded: this.props.expandAllCommits }, () => {
      if (this.state.expanded) {
        this.loadPrJsonForActiveTab(this.state.activeTabKey);
      }

      this.activateTargetPr();
    });
  }

  if (
    this.props.targetPrNumber &&
    this.props.targetPrNumber !== prevProps.targetPrNumber
  ) {
    this.activateTargetPr();
  }
}

  componentWillUnmount() {
    this._isMounted = false;
    if (this.toggleLoaderTimeout) {
      clearTimeout(this.toggleLoaderTimeout);
    }
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
  }

  startToggleLoader = () => {
    if (this.toggleLoaderTimeout) {
      clearTimeout(this.toggleLoaderTimeout);
    }

    this.setState({ toggleLoading: true });
    this.toggleLoaderTimeout = setTimeout(() => {
      if (this._isMounted) {
        this.setState({ toggleLoading: false });
      }
    }, 250);
  };
findTabKeyForPr = (targetPrNumber) => {
  const { ibComparison } = this.state;
  const query = String(targetPrNumber || "").trim();

  if (!query || !Array.isArray(ibComparison)) return null;

  for (let pos = 0; pos < ibComparison.length; pos++) {
    const ib = ibComparison[pos];

    if (Array.isArray(ib.merged_prs)) {
      const foundCmssw = ib.merged_prs.some(
        (pr) => String(pr?.number) === query
      );

      if (foundCmssw) {
        return `cmssw-${pos}`;
      }
    }

    if (ib.cmsdist_merged_prs && typeof ib.cmsdist_merged_prs === "object") {
      for (const [arch, prList] of Object.entries(ib.cmsdist_merged_prs)) {
        if (!Array.isArray(prList)) continue;

        const foundCmsdist = prList.some(
          (pr) => String(pr?.number) === query
        );

        if (foundCmsdist) {
          return `cmsdist-${pos}-${arch}`;
        }
      }
    }
  }

  return null;
};
  getSeriesKeyForTab = (tabKey) => {
    const { ibComparison } = this.state;
    if (!Array.isArray(ibComparison) || ibComparison.length === 0) return null;

    const match = String(tabKey).match(/^(cmssw|cmsdist)-(\d+)/);
    if (!match) return null;

    const index = Number(match[2]);
    const ib = ibComparison[index];
    if (!ib) return null;

    const currentTag = getCurrentIbTag(ib);
    const previousTag = getPreviousIbTag(ib);

    return getSeriesKeyFromTag(currentTag || previousTag);
  };

  loadPrJsonForActiveTab = async (tabKey) => {
    const seriesKey = this.getSeriesKeyForTab(tabKey);
    if (!seriesKey) return null;
    return this.loadPrJsonForSeriesKey(seriesKey);
  };

  loadPrJsonForSeriesKey = async (seriesKey) => {
    if (!seriesKey) return null;

    if (isFreshCache(globalPrJsonCache[seriesKey], PR_MEMORY_TTL_MS)) {
      const data = globalPrJsonCache[seriesKey].data;

      if (this._isMounted) {
        this.setState((prev) => ({
          prJsonCache: {
            ...prev.prJsonCache,
            [seriesKey]: data
          },
          prJsonLoading: {
            ...prev.prJsonLoading,
            [seriesKey]: false
          },
          prJsonErrors: {
            ...prev.prJsonErrors,
            [seriesKey]: null
          }
        }));
      }

      return data;
    }

    if (globalPrJsonPromises[seriesKey]) {
      if (this._isMounted) {
        this.setState((prev) => ({
          prJsonLoading: {
            ...prev.prJsonLoading,
            [seriesKey]: true
          },
          prJsonErrors: {
            ...prev.prJsonErrors,
            [seriesKey]: null
          }
        }));
      }

      try {
        const data = await globalPrJsonPromises[seriesKey];

        if (this._isMounted) {
          this.setState((prev) => ({
            prJsonCache: {
              ...prev.prJsonCache,
              [seriesKey]: data
            },
            prJsonLoading: {
              ...prev.prJsonLoading,
              [seriesKey]: false
            },
            prJsonErrors: {
              ...prev.prJsonErrors,
              [seriesKey]: null
            }
          }));
        }

        return data;
      } catch (error) {
        if (this._isMounted) {
          this.setState((prev) => ({
            prJsonErrors: {
              ...prev.prJsonErrors,
              [seriesKey]: error.message
            },
            prJsonLoading: {
              ...prev.prJsonLoading,
              [seriesKey]: false
            }
          }));
        }
        return null;
      }
    }

    if (this._isMounted) {
      this.setState((prev) => ({
        prJsonLoading: {
          ...prev.prJsonLoading,
          [seriesKey]: true
        },
        prJsonErrors: {
          ...prev.prJsonErrors,
          [seriesKey]: null
        }
      }));
    }

    globalPrJsonPromises[seriesKey] = getSingleFile({
      fileUrl: getPrJsonUrl(seriesKey)
    })
      .then((response) => {
        const data = response?.data || {};
        globalPrJsonCache[seriesKey] = {
          data,
          cachedAt: Date.now()
        };
        return data;
      })
      .finally(() => {
        delete globalPrJsonPromises[seriesKey];
      });

    try {
      const data = await globalPrJsonPromises[seriesKey];

      if (this._isMounted) {
        this.setState((prev) => ({
          prJsonCache: {
            ...prev.prJsonCache,
            [seriesKey]: data
          },
          prJsonLoading: {
            ...prev.prJsonLoading,
            [seriesKey]: false
          },
          prJsonErrors: {
            ...prev.prJsonErrors,
            [seriesKey]: null
          }
        }));
      }

      return data;
    } catch (error) {
      if (this._isMounted) {
        this.setState((prev) => ({
          prJsonErrors: {
            ...prev.prJsonErrors,
            [seriesKey]: error.message
          },
          prJsonLoading: {
            ...prev.prJsonLoading,
            [seriesKey]: false
          }
        }));
      }
      return null;
    }
  };
activateTargetPr = () => {
  if (!this.props.targetPrNumber) return;

  const tabKey = this.findTabKeyForPr(this.props.targetPrNumber);

  if (!tabKey) return;

  this.setState(
    {
      expanded: true,
      activeTabKey: tabKey
    },
    () => {
      this.loadPrJsonForActiveTab(tabKey);

      setTimeout(() => {
        const el = document.querySelector(
          `[data-target-pr="${this.props.targetPrNumber}"]`
        );

        if (el) {
          el.scrollIntoView({
            behavior: "smooth",
            block: "center"
          });
        }
      }, 1000);
    }
  );
};

  loadCmsswLabels = async () => {
    if (isFreshCache(globalCmsswLabelsCache, LABELS_MEMORY_TTL_MS)) {
      const data = globalCmsswLabelsCache.data;

      if (this._isMounted) {
        this.setState({
          cmsswLabelsMap: data,
          cmsswLabelsLoading: false,
          cmsswLabelsError: null
        });
      }

      return data;
    }

    if (globalCmsswLabelsPromise) {
      if (this._isMounted) {
        this.setState({
          cmsswLabelsLoading: true,
          cmsswLabelsError: null
        });
      }

      try {
        const data = await globalCmsswLabelsPromise;
        if (this._isMounted) {
          this.setState({
            cmsswLabelsMap: data || {},
            cmsswLabelsLoading: false,
            cmsswLabelsError: null
          });
        }
        return data;
      } catch (error) {
        if (this._isMounted) {
          this.setState({
            cmsswLabelsError: error.message,
            cmsswLabelsLoading: false
          });
        }
        return null;
      }
    }

    if (this._isMounted) {
      this.setState({
        cmsswLabelsLoading: true,
        cmsswLabelsError: null
      });
    }

    globalCmsswLabelsPromise = getSingleFile({
      fileUrl: getCmsswLabelsUrl()
    })
      .then((response) => {
        const data = response?.data || {};
        globalCmsswLabelsCache = {
          data,
          cachedAt: Date.now()
        };
        return data;
      })
      .finally(() => {
        globalCmsswLabelsPromise = null;
      });

    try {
      const data = await globalCmsswLabelsPromise;
      if (this._isMounted) {
        this.setState({
          cmsswLabelsMap: data || {},
          cmsswLabelsLoading: false,
          cmsswLabelsError: null
        });
      }
      return data;
    } catch (error) {
      if (this._isMounted) {
        this.setState({
          cmsswLabelsError: error.message,
          cmsswLabelsLoading: false
        });
      }
      return null;
    }
  };

  toggleExpand = () => {
    this.startToggleLoader();
    this.setState(
      (prev) => ({ expanded: !prev.expanded }),
      () => {
        if (this.state.expanded) {
          this.loadPrJsonForActiveTab(this.state.activeTabKey);
        }
      }
    );
  };

  handleTabSelect = (selectedKey) => {
    if (!selectedKey) return;

    this.setState({ activeTabKey: selectedKey }, () => {
      this.loadPrJsonForActiveTab(selectedKey);
    });
  };

  openPreviewModal = async (pr, repo, seriesKey) => {
    this.setState({
      previewPr: pr,
      previewLoading: true,
      previewError: null,
      previewLoadingPrNumber: pr.number
    });

    let finalPr = pr;
    let previewError = null;

    try {
      let prJsonData = null;

      if (seriesKey && isFreshCache(globalPrJsonCache[seriesKey], PR_MEMORY_TTL_MS)) {
        prJsonData = globalPrJsonCache[seriesKey].data;
      }

      if (!prJsonData && seriesKey) {
        prJsonData = await this.loadPrJsonForSeriesKey(seriesKey);
      }

      if (prJsonData) {
        const enriched = enrichMergedPrs([pr], repo, prJsonData);
        if (Array.isArray(enriched) && enriched[0]) {
          finalPr = enriched[0];
        }
      } else if (seriesKey) {
        previewError =
          this.state.prJsonErrors[seriesKey] ||
          "Could not load full PR metadata. Showing available data only.";
      }
    } catch (error) {
      previewError =
        error?.message ||
        "Could not load full PR metadata. Showing available data only.";
    }

    if (this._isMounted) {
      this.setState({
        previewPr: finalPr,
        previewLoading: false,
        previewError,
        previewLoadingPrNumber: null
      });
    }
  };

  closePreviewModal = () => {
    this.setState({
      previewPr: null,
      previewLoading: false,
      previewError: null,
      previewLoadingPrNumber: null
    });
  };

  renderPreviewModal() {
    const { previewPr, previewLoading, previewError, cmsswLabelsMap } = this.state;

    return (
      <Modal show={!!previewPr} onHide={this.closePreviewModal} centered size="lg" scrollable>
        <Modal.Header closeButton className="bg-light border-0">
          <Modal.Title className="d-flex align-items-center gap-2">
            <FaGithub className="text-dark" size={20} />
            <span>Pull Request #{previewPr?.number}</span>
          </Modal.Title>
        </Modal.Header>

        <Modal.Body style={{ minHeight: "650px", maxHeight: "650px" }}>
          {previewLoading && (
            <div
              className="d-flex flex-column align-items-center justify-content-center h-100"
              style={{ color: THEME.text.muted, minHeight: "560px" }}
            >
              <Spinner animation="border" className="mb-3" />
              <div style={{ fontWeight: 800 }}>Loading PR preview...</div>
            </div>
          )}

          {!previewLoading && previewError && (
            <Alert variant="warning" className="mb-3">
              {previewError}
            </Alert>
          )}

          {!previewLoading && previewPr && (
            <GitHubPreviewContent
              pr={previewPr}
              cmsswLabelsMap={cmsswLabelsMap}
              fixedHeight
            />
          )}
        </Modal.Body>
      </Modal>
    );
  }

  render() {
    const {
      ibComparison,
      expanded,
      activeTabKey,
      cmsdistSearch,
      prJsonCache,
      cmsswLabelsMap,
      previewLoadingPrNumber,
      toggleLoading
    } = this.state;

    const cmsswTabList = [];
    const cmsswTabPaneList = [];
    const cmsDistAllItems = [];
    const cmsDistTabPaneList = [];
    const compareInfoMap = {};

    if (!Array.isArray(ibComparison) || ibComparison.length === 0) {
      return (
        <>
          <Card style={styles.card}>
            <Card.Header
              style={styles.cardHeader}
              onClick={this.toggleExpand}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = THEME.surfaceMuted2)
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = THEME.surfaceMuted)
              }
            >
              <div style={styles.cardHeaderContent}>
                <FaCodeBranch style={{ color: THEME.primary }} />
                <span style={{ fontSize: "0.95rem" }}>Commits & Pull Requests</span>
              </div>
              <div style={styles.expandButton}>
                {toggleLoading && <Spinner animation="border" size="sm" />}
                {!toggleLoading && <FaGripLines size={12} />}
                <span>{expanded ? "Hide" : "Show"}</span>
                {expanded ? <FaChevronUp size={12} /> : <FaChevronDown size={12} />}
              </div>
            </Card.Header>

            <Collapse in={expanded}>
              <Card.Body style={{ ...styles.cardBody, padding: "2rem" }}>
                <div className="text-center" style={{ color: THEME.text.muted }}>
                  <FaCodeBranch size={36} className="mb-2" style={{ opacity: 0.5 }} />
                  <p style={{ fontSize: "0.9rem", fontWeight: 800 }}>
                    No commit data available
                  </p>
                </div>
              </Card.Body>
            </Collapse>
          </Card>

          {this.renderPreviewModal()}
        </>
      );
    }

    ibComparison.forEach((ib, pos) => {
      if (!ib) return;

      const currentTag = getCurrentIbTag(ib);
      const previousTag = getPreviousIbTag(ib);
      const seriesKey = getSeriesKeyFromTag(currentTag || previousTag);

      let prJsonData = null;
      if (seriesKey) {
        if (isFreshCache(globalPrJsonCache[seriesKey], PR_MEMORY_TTL_MS)) {
          prJsonData = globalPrJsonCache[seriesKey].data;
        } else if (prJsonCache[seriesKey]) {
          prJsonData = prJsonCache[seriesKey];
        }
      }

      const cmsswTabKey = `cmssw-${pos}`;

      compareInfoMap[cmsswTabKey] = {
        repoName: "CMSSW",
        startTag: previousTag,
        endTag: currentTag,
        url: githubCompareTags("cms-sw/cmssw", previousTag, currentTag)
      };

      cmsswTabList.push(
        <Nav.Item key={`cmssw-tab-${ib.release_queue || "unknown"}-${pos}`}>
          <Nav.Link
            eventKey={cmsswTabKey}
           style={{
              ...styles.tabLink(activeTabKey === cmsswTabKey),
              color: hasPrs(ib.merged_prs)
                ? "#2563eb"
                : styles.tabLink(activeTabKey === cmsswTabKey).color,
              fontWeight: hasPrs(ib.merged_prs) ? 900 : 800
            }}
          >
            {getDisplayName(ib.release_queue)}
          </Nav.Link>
        </Nav.Item>
      );

      cmsswTabPaneList.push(
        <Tab.Pane
          key={`cmssw-pane-${ib.release_queue || "unknown"}-${pos}`}
          eventKey={cmsswTabKey}
          style={styles.tabPane}
        >
          {/* {renderComparisonLink("cms-sw/cmssw", previousTag, currentTag)} */}
          {renderCommits(
            ib.merged_prs,
            previousTag,
            "cms-sw/cmssw",
            expanded,
            prJsonData,
            cmsswLabelsMap,
            this.openPreviewModal,
            previewLoadingPrNumber,
            seriesKey,
            this.props.targetPrNumber
          )}
        </Tab.Pane>
      );

      if (
        ib.cmsdist_merged_prs &&
        typeof ib.cmsdist_merged_prs === "object" &&
        Object.keys(ib.cmsdist_merged_prs).length > 0
      ) {
        Object.entries(ib.cmsdist_merged_prs).forEach(([arch, prListByArch]) => {
          const displayName = getDisplayName(ib.release_queue);
          const tabKey = `cmsdist-${pos}-${arch}`;
          const [prevTag, nextTag] =
            ib.cmsdist_compared_tags?.[arch]?.split("..") || [];
          if (!prevTag || !nextTag) return;

          compareInfoMap[tabKey] = {
            repoName: "CMSDIST",
            startTag: prevTag,
            endTag: nextTag,
            url: githubCompareTags("cms-sw/cmsdist", prevTag, nextTag)
          };

          cmsDistAllItems.push(
            <NavDropdown.Item
              key={`cmsdist-item-${displayName}-${arch}`}
              eventKey={tabKey}
              className="d-flex align-items-center"
              style={ styles.cmsdistItem }
              data-search={`${displayName} ${arch}`.toLowerCase()}
              data-has-prs={hasPrs(prListByArch) ? "true" : "false"}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = THEME.surfaceMuted2)
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              <FaCodeBranch
                className="me-2"
                style={{ color: hasPrs(prListByArch) ? "#2563eb" : THEME.text.muted }}
                size={12}
              />
              <span
                className="fw-semibold"
                style={{ color: hasPrs(prListByArch) ? "#2563eb" : THEME.text.primary }}
              >
                {displayName}
              </span>
              <span className="text-muted mx-2">•</span>
              <code style={{
                ...styles.tag,
                padding: "0.1rem 0.45rem",
                color: hasPrs(prListByArch) ? "#2563eb" : THEME.text.primary,
                fontWeight: hasPrs(prListByArch) ? 800 : 600
                }}
              >
                {arch}
              </code>
            </NavDropdown.Item>
          );

          cmsDistTabPaneList.push(
            <Tab.Pane
              key={`cmsdist-pane-${tabKey}`}
              eventKey={tabKey}
              style={styles.tabPane}
            >
              {/* {renderComparisonLink("cms-sw/cmsdist", prevTag, nextTag)} */}
              {renderCommits(
                prListByArch,
                prevTag,
                "cms-sw/cmsdist",
                expanded,
                prJsonData,
                cmsswLabelsMap,
                this.openPreviewModal,
                previewLoadingPrNumber,
                seriesKey,
                this.props.targetPrNumber
              )}
            </Tab.Pane>
          );
        });
      }
    });

    const needle = (cmsdistSearch || "").trim().toLowerCase();
    const cmsDistFilteredItems = !needle
      ? cmsDistAllItems
      : cmsDistAllItems.filter((node) => {
          const hay = node?.props?.["data-search"] || "";
          return hay.includes(needle);
        });
    const hasCmsDistPrs = cmsDistAllItems.some((item) => item?.props?.["data-has-prs"] === "true");      
    const hasAnyCmsDist = cmsDistAllItems.length > 0;
    
    const activeCompareInfo = compareInfoMap[activeTabKey] || null;

    return (
      <>
        <Card style={styles.card}>
          {/* <Card.Header
            style={styles.cardHeader}
            onClick={this.toggleExpand}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = THEME.surfaceMuted2)
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = THEME.surfaceMuted)
            }
          >
            <div style={styles.cardHeaderContent}>
              <GoGitPullRequest size={18} style={{ color: THEME.primary }} />
              <span style={{ fontSize: "0.90rem" }}>Pull Requests</span>
            </div>

            <div style={styles.expandButton}>
              {toggleLoading && <Spinner animation="border" size="sm" />}
              {!toggleLoading && <FaGripLines size={12} />}
              <span>{expanded ? "Hide" : "Show"}</span>
              {expanded ? <FaChevronUp size={12} /> : <FaChevronDown size={12} />}
            </div>
          </Card.Header> */}

          <Collapse in={expanded}>
            <Card.Body style={styles.cardBody}>
              <Tab.Container activeKey={activeTabKey} onSelect={this.handleTabSelect}>
                <Row className="g-0">
                  <Col sm={12}>
                    <Nav variant="tabs" className="border-bottom-0" style={styles.navTabsWrap}>
                      {cmsswTabList}

                      {hasAnyCmsDist && (
                        <NavDropdown
                            title={
                                <span
                                  style={{
                                    color: hasCmsDistPrs ? "#2563eb" : THEME.text.primary,
                                    fontWeight: hasCmsDistPrs ? 900 : 800
                                  }}
                                >
                                  {/* <FaGithub className="me-1" size={9} /> */}
                                  CMS Dist
                                </span>
                            }
                            id="cmsdist-dropdown"
                            className="compact-dropdown-tab"
                            menuVariant="light"
                            renderMenuOnMount
                            popperConfig={{
                              strategy: "fixed"
                            }}
                          >
                          <div
                            style={styles.cmsdistSearchWrap}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div style={styles.cmsdistSearchInputWrap}>
                              <FaSearch size={12} style={{ color: THEME.text.muted }} />
                              <input
                                type="text"
                                value={cmsdistSearch}
                                placeholder="Search (Architectures)..."
                                onChange={(e) =>
                                  this.setState({ cmsdistSearch: e.target.value })
                                }
                                style={styles.cmsdistSearchInput}
                              />
                            </div>
                          </div>

                          <NavDropdown.Divider />

                          <div style={{ maxHeight: 380, overflowY: "auto" }}>
                            {cmsDistFilteredItems.length > 0 ? (
                              cmsDistFilteredItems
                            ) : (
                              <div
                                style={{
                                  padding: "10px 14px",
                                  color: THEME.text.muted,
                                  fontSize: "0.82rem"
                                }}
                              >
                                No matches
                              </div>
                            )}
                          </div>
                        </NavDropdown>
                      )}
                    {activeCompareInfo && (
                      <OverlayTrigger
                        placement="bottom"
                        delay={{ show: 120, hide: 80 }}
                        overlay={
                          <Popover
                            id="compare-popover"
                            style={{
                              border: "none",
                              borderRadius: "14px",
                              boxShadow: "0 14px 34px rgba(15, 23, 42, 0.18)",
                              overflow: "hidden",
                              minWidth: "320px"
                            }}
                          >
                            <Popover.Body style={{ padding: 0 }}>
                              <div
                                style={{
                                  padding: "12px 14px",
                                  background: THEME.surfaceMuted,
                                  borderBottom: `1px solid ${THEME.border}`
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: "0.72rem",
                                    fontWeight: 900,
                                    color: THEME.text.muted,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.04em"
                                  }}
                                >
                                  Branch Compare
                                </div>

                                <div
                                  style={{
                                    marginTop: "4px",
                                    fontSize: "0.9rem",
                                    fontWeight: 900,
                                    color: THEME.text.primary
                                  }}
                                >
                                  {activeCompareInfo.repoName}
                                </div>
                              </div>

                              <div style={{ padding: "14px" }}>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    marginBottom: "10px",
                                    color: THEME.text.secondary,
                                    fontSize: "0.82rem",
                                    fontWeight: 700
                                  }}
                                >
                                  <FaCodeCompare size={20} style={{ color: THEME.primary }} />
                                  Comparing branches
                                </div>

                                <div
                                  style={{
                                    background: THEME.surfaceMuted,
                                    border: `1px solid ${THEME.border}`,
                                    borderRadius: "10px",
                                    padding: "10px",
                                    display: "grid",
                                    gap: "8px"
                                  }}
                                >
                                  <code style={{ ...styles.tag, display: "block" }}>
                                    {activeCompareInfo.startTag}
                                  </code>

                                  <div
                                    style={{
                                      textAlign: "center",
                                      color: THEME.text.muted,
                                      fontWeight: 900
                                    }}
                                  >
                                    ↓
                                  </div>

                                  <code style={{ ...styles.tag, display: "block" }}>
                                    {activeCompareInfo.endTag}
                                  </code>
                                </div>

                                <div
                                  style={{
                                    marginTop: "10px",
                                    fontSize: "0.76rem",
                                    color: THEME.text.muted
                                  }}
                                >
                                
                                </div>
                              </div>
                            </Popover.Body>
                          </Popover>
                        }
                      >
                        <a
                          href={activeCompareInfo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Open branch compare"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "32px",
                            height: "30px",
                            borderRadius: "9px",
                            border: `1px solid ${THEME.borderDark}`,
                            background:
                              "linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)",
                            color: THEME.primary,
                            textDecoration: "none",
                            marginLeft: "4px",
                            marginBottom: "2px",
                            boxShadow: "0 2px 8px rgba(37, 99, 235, 0.12)"
                          }}
                        >
                          <FaCodeCompare size={13} />
                        </a>
                      </OverlayTrigger>
)}
                    </Nav>
                  </Col>

                  <Col sm={12}>
                    <Tab.Content className="border-top" style={{ borderColor: THEME.border }}>
                      {cmsswTabPaneList}
                      {cmsDistTabPaneList}
                    </Tab.Content>
                  </Col>
                </Row>
              </Tab.Container>
            </Card.Body>
          </Collapse>
        </Card>

        {this.renderPreviewModal()}
      </>
    );
  }
}

Commits.propTypes = {
  commitPanelProps: PropTypes.object,
  data: PropTypes.array,
  expandAllCommits: PropTypes.bool,
  targetPrNumber: PropTypes.string
};

Commits.defaultProps = {
  commitPanelProps: {},
  data: [],
  expandAllCommits: false,
  targetPrNumber: ""
};

export default Commits;
