import React, { useMemo, useState } from 'react';
import StatusDot from "../common/StatusDot";
import { testGroupState } from "../../Utils/buildStatus";
import { SiNvidia, SiAmd } from "react-icons/si";
import PropTypes from 'prop-types';
import { Dropdown, Form } from 'react-bootstrap';
import { config } from '../../config';
import {
  FaCheckCircle,
  FaExclamationTriangle,
  FaExclamationCircle,
  FaMicrochip,
  FaDatabase,
  FaSearch
} from 'react-icons/fa';
import { BsGpuCard } from "react-icons/bs";

const { urls } = config;
const MAX_VISIBLE = Number.MAX_SAFE_INTEGER;

const COLOR_SCHEME = {
  success: { bg: '#198754', text: '#ffffff', border: '#146c43' },
  danger: { bg: '#dc3545', text: '#ffffff', border: '#b02a37' },
  secondary: { bg: '#6c757d', text: '#ffffff', border: '#565e64' },
  warning: { bg: '#ffc107', text: '#000000', border: '#cc9a06' }
};

const getBuildOrUnitUrl = ({ file, arch, ibName, urlParameter = '' }) => {
  if (!file) return undefined;

  if (file === 'not-ready') {
    return `${urls.scramDetailUrl}${arch};${ibName}`;
  }

  let linkParts = file.split('/');
  linkParts = linkParts.slice(4, 9);

  return `${urls.buildOrUnitTestUrl}${linkParts.join('/')}${urlParameter}`;
};

const getStatusIcon = (variant) => {
  switch (variant) {
    case 'success':
      return <FaCheckCircle className="me-1" />;
    case 'danger':
      return <FaExclamationCircle className="me-1" />;
    case 'warning':
      return <FaExclamationTriangle className="me-1" />;
    default:
      return null;
  }
};
//helper for nvidia and AMD icons
const getVendorIcon = (name = "") => {
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

  return null;
};
const UnitTestsLabel = ({ tests = {}, type_name }) => {
  const [search, setSearch] = useState('');

  if (!tests || Object.keys(tests).length === 0) return null;

  const summaryState = testGroupState(tests, 'num_fails');
  const anyFailure = Object.values(tests).some(
    (t) => Number(t.details?.num_fails) > 0
  );

  const configMap = {
    gpu: {
      title: 'Test',
      icon: <BsGpuCard size={20} style={{ color: anyFailure ? "#842029" : "#2c6e2c" }} />,
      param: 'gpu',
      field: 'gpu'
    },
    rntuple: {
      title: 'RNTuple Test',
      icon: <FaDatabase size={16} style={{ color: anyFailure ? "#842029" : "#2c6e2c" }} />,
      param: 'other',
      field: 'other'
    }
  };

  const current = configMap[type_name];

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
      const numFails = Number(item.details?.num_fails ?? 0);
      return numFails > 0;
    });

    const passed = entries.filter(([, item]) => {
      const numFails = Number(item.details?.num_fails ?? 0);
      return numFails === 0;
    });

    return {
      failed: failed.slice(0, MAX_VISIBLE),
      passed: passed.slice(0, MAX_VISIBLE)
    };
  }, [tests, search]);

  const renderTestItem = ([key, item]) => {
    const failed = Number(item.details?.num_fails ?? 0);
    const passed = Number(item.details?.num_passed ?? 0);
    const total = Number(item.details?.num_total ?? 0);

    const variant = failed > 0 ? 'danger' : 'success';
    const colors = COLOR_SCHEME[variant] || COLOR_SCHEME.secondary;

    const selectedItem = item[current.field];

    const url = getBuildOrUnitUrl({
      file: item.file,
      arch: item.arch,
      ibName: item.release_name,
      urlParameter: `?utests/${current.param}/${selectedItem}`
    });

    return (
      <Dropdown.Item
        key={key}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid #e9ecef'
        }}
      >
        <div className="d-flex justify-content-between align-items-center">
          <div className="d-flex align-items-center">
            {getVendorIcon(key) || current.icon}
            <span className="fw-bold ms-1">{key}</span>
          </div>

          <div
            className="d-inline-flex align-items-center px-2 py-1 rounded"
            style={{
              backgroundColor: colors.bg,
              color: colors.text,
              fontSize: '0.85rem',
              fontWeight: '500',
              minWidth: '40px',
              justifyContent: 'center'
            }}
          >
            {getStatusIcon(variant)}
            {/* <span className="ms-1">{failed > 0 ? failed : passed}</span> */}
          </div>
        </div>

        {/* <div className="small text-muted mt-1">
          Total: {total} | Passed: {passed} | Failed: {failed}
        </div> */}
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
        id={`${type_name}-unit-tests-toggle`}
        style={toggleStyle}
        title={`${summaryState.status === 'danger' ? 'Failures' : summaryState.status === 'warning' ? 'Warnings' : summaryState.status === 'success' ? 'Passed' : 'Unknown'}${summaryState.running ? ' · running' : ''}`}
      >
        <StatusDot {...summaryState} size={22} />
        <span>{current.title}</span>
        {/* {anyFailure ? (
          <FaExclamationTriangle className="ms-1" />
        ) : (
          <FaCheckCircle className="ms-1" />
        )} */}
      </Dropdown.Toggle>

      <Dropdown.Menu className="ib-test-dropdown"
        style={{
          minWidth: "min(340px, calc(100vw - 24px))",
          maxWidth: "calc(100vw - 24px)",
          maxHeight: '420px',
          padding: '8px 0',
          overflowY: 'auto'
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
                fontSize: '0.8rem',
                color: COLOR_SCHEME.danger.bg,
                background: '#f8d7da',
                borderTop: '1px solid #e9ecef',
                borderBottom: '1px solid #e9ecef'
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
                fontSize: '0.8rem',
                color: COLOR_SCHEME.success.bg,
                background: '#d1e7dd',
                borderTop: '1px solid #e9ecef',
                borderBottom: '1px solid #e9ecef'
              }}
            >
              Passed Tests ({filteredTests.passed.length})
            </div>
            {filteredTests.passed.map(renderTestItem)}
          </>
        )}

        {totalVisible === 0 && (
          <Dropdown.Item disabled className="text-center text-muted py-2">
            No matching tests
          </Dropdown.Item>
        )}
      </Dropdown.Menu>
    </Dropdown>
  );
};

UnitTestsLabel.propTypes = {
  tests: PropTypes.object,
  type_name: PropTypes.oneOf(['gpu', 'rntuple']).isRequired
};

// UnitTestsLabel.defaultProps = {
//   tests: {}
// };

export { UnitTestsLabel };
