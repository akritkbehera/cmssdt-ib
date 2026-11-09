import React, { useState, useMemo } from "react";
import StatusDot from "../common/StatusDot";
import { testGroupState } from "../../Utils/buildStatus";
import PropTypes from "prop-types";
import { Dropdown, Form } from "react-bootstrap";
import { config } from "../../config";
import {
  FaMicrochip,
  FaDatabase,
  FaCheckCircle,
  FaExclamationTriangle,
  FaExclamationCircle,
  FaSearch
} from "react-icons/fa";

import { SiNvidia, SiAmd } from "react-icons/si";
import { BsGpuCard } from "react-icons/bs";

const { urls } = config;
const MAX_VISIBLE = Number.MAX_SAFE_INTEGER;

const COLOR_SCHEME = {
  success: { bg: "#198754", text: "#ffffff", border: "#146c43" },
  danger: { bg: "#dc3545", text: "#ffffff", border: "#b02a37" },
  secondary: { bg: "#6c757d", text: "#ffffff", border: "#565e64" },
  warning: { bg: "#ffc107", text: "#000000", border: "#cc9a06" }
};

const getIcon = (type, color) => {
  switch (type) {
    case "gpu":
      return <BsGpuCard size={20} style={{ color }}/>;
    case "rntuple":
      return <FaDatabase size={20} style={{ color }} />;
    default:
      return null;
  }
};

const getVendorIcon = (name = "", type_name = "") => {
  // For RNTuple always show a simple CPU icon
  if (type_name === "rntuple") {
    return (
      <FaMicrochip
        className="me-2"
        style={{ color: "#64748b", fontSize: "1rem" }}
      />
    );
  }

  const lower = name.toLowerCase();

  if (lower.includes("nvidia")) {
    return (
      <SiNvidia
        className="me-2"
        style={{ color: "#76b900", fontSize: "1.1rem" }}
      />
    );
  }

  if (lower.includes("amd")) {
    return (
      <SiAmd
        className="me-2"
        style={{
          color: "#ed1c24",
          fontSize: "1.2rem",
          transform: "scale(1.2)",
          display: "inline-block"
        }}
      />
    );
  }

  return (
    <FaMicrochip
      className="me-2"
      style={{ color: "#64748b", fontSize: "1rem" }}
    />
  );
};

const getStatusIcon = (variant) => {
  switch (variant) {
    case "success":
      return <FaCheckCircle className="me-1" />;
    case "danger":
      return <FaExclamationCircle className="me-1" />;
    case "warning":
      return <FaExclamationTriangle className="me-1" />;
    default:
      return null;
  }
};

const RelvalsLabel = ({ tests = {}, type_name }) => {
  const [search, setSearch] = useState("");

  if (!tests || Object.keys(tests).length === 0) return null;

  const summaryState = testGroupState(tests, 'num_failed');
  const anyFailure = Object.values(tests).some(
    (t) => t.details && t.details.num_failed > 0
  );

  const currentType = {
    gpu: { title: "RelVals", field: "gpu", selected: "GPUs" },
    rntuple: { title: "RNTuple", field: "other", selected: "Others" }
  }[type_name];

const toggleStyle = {
  backgroundColor: anyFailure ? "#f8d7da" : "#e6f7e6",
  color: anyFailure ? "#842029" : "#2c6e2c",
  border: anyFailure ? "1px solid #f5c2c7" : "1px solid #b7e0b7",
  boxShadow: "none",
  padding: "4px 10px",
  fontSize: "0.85rem",
  fontWeight: "500",
  borderRadius: "4px",
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  lineHeight: 1.0,
  transition: "all 0.2s ease",
  whiteSpace: "nowrap"
};

  const filteredTests = useMemo(() => {
    const entries = Object.entries(tests).filter(([key]) =>
      key.toLowerCase().includes(search.toLowerCase())
    );

    const failed = entries.filter(([, item]) => {
      const num_failed = Number(item?.details?.num_failed ?? 0);
      return num_failed > 0;
    });

    const passed = entries.filter(([, item]) => {
      const num_failed = Number(item?.details?.num_failed ?? 0);
      return num_failed === 0;
    });

    return {
      failed: failed.slice(0, MAX_VISIBLE),
      passed: passed.slice(0, MAX_VISIBLE)
    };
  }, [tests, search]);

  const renderTestItem = ([key, item]) => {
    const details = item.details || {};
    const num_failed = Number(details.num_failed ?? 0);
    const num_passed = Number(details.num_passed ?? 0);
    const num_total = Number(details.num_total ?? 0);
    const state = num_failed > 0 ? "failed" : "passed";
    const variant = state === "failed" ? "danger" : "success";

    const selected_item = item[currentType.field];

    const match = item.release_name?.match(
      /^(CMSSW_\d+_\d+)_((.+_|)X)_(.*)$/
    );
    if (!match) return null;

    const url = urls.newRelValsSpecific(
      match[1],
      match[4],
      match[2],
      item.arch,
      `&selected${currentType.selected}=${selected_item}&selectedStatus=${state}`
    );

    const colors = COLOR_SCHEME[variant] || COLOR_SCHEME.secondary;

    return (
      <Dropdown.Item
        key={key}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ padding: "10px 16px", borderBottom: "1px solid #e9ecef" }}
      >
        <div className="d-flex justify-content-between align-items-center">
          <div className="d-flex align-items-center">
            {getVendorIcon(key, type_name)}
            <span className="fw-bold ms-1">{key}</span>
          </div>
          <div
            className="d-inline-flex align-items-center px-2 py-1 rounded"
            style={{
              backgroundColor: colors.bg,
              color: colors.text,
              fontSize: "0.85rem",
              fontWeight: "500",
              minWidth: "40px",
              justifyContent: "center"
            }}
          >
            {getStatusIcon(variant)}
            <span className="ms-1">
              {num_failed > 0 ? num_failed : num_passed}
            </span>
          </div>
        </div>
        <div className="small text-muted mt-1">
          Total: {num_total} | Passed: {num_passed} | Failed: {num_failed}
        </div>
      </Dropdown.Item>
    );
  };

  const totalVisible =
    filteredTests.failed.length + filteredTests.passed.length;

  return (
    <Dropdown className="d-inline-block me-1" autoClose="outside">
      <Dropdown.Toggle
        variant="light"
        className="ib-section-pill"
        size="sm"
        id={`${type_name}-relvals-toggle`}
        style={toggleStyle}
        title={`${summaryState.status === 'danger' ? 'Failures' : summaryState.status === 'warning' ? 'Warnings' : summaryState.status === 'success' ? 'Passed' : 'Unknown'}${summaryState.running ? ' · running' : ''}`}
      >
        <StatusDot {...summaryState} size={22} />
        <span>{currentType.title}</span>
        {/* {anyFailure ? (
          <FaExclamationTriangle className="ms-1" />
        ) : (
          <FaCheckCircle className="ms-1" />
        )} */}
      </Dropdown.Toggle>

      <Dropdown.Menu
        style={{
          minWidth: "340px",
          maxHeight: "420px",
          padding: "8px 0",
          overflowY: "auto"
        }}
      >
        <Form className="px-2 mb-2">
          <div className="d-flex align-items-center border rounded px-2">
            <FaSearch className="text-muted me-2" />
            <Form.Control
              size="sm"
              placeholder="Search tests..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-0 shadow-none"
            />
          </div>
        </Form>

        {filteredTests.failed.length > 0 && (
          <>
            <div
              className="px-3 py-2 fw-bold"
              style={{
                fontSize: "0.8rem",
                color: COLOR_SCHEME.danger.bg,
                background: "#f8d7da",
                borderTop: "1px solid #e9ecef",
                borderBottom: "1px solid #e9ecef"
              }}
            >
              Failed Tests ({filteredTests.failed.length})
            </div>
            {filteredTests.failed.map(renderTestItem)}
          </>
        )}

        {filteredTests.passed.length > 0 && (
          <>
            <div
              className="px-3 py-2 fw-bold"
              style={{
                fontSize: "0.8rem",
                color: COLOR_SCHEME.success.bg,
                background: "#d1e7dd",
                borderTop: "1px solid #e9ecef",
                borderBottom: "1px solid #e9ecef"
              }}
            >
              Passed Tests ({filteredTests.passed.length})
            </div>
            {filteredTests.passed.map(renderTestItem)}
          </>
        )}

        {totalVisible === 0 && (
          <Dropdown.Item disabled className="text-center text-muted py-2">
            No tests found
          </Dropdown.Item>
        )}
      </Dropdown.Menu>
    </Dropdown>
  );
};

RelvalsLabel.propTypes = {
  tests: PropTypes.object,
  type_name: PropTypes.oneOf(["gpu", "rntuple"]).isRequired
};

export { RelvalsLabel };