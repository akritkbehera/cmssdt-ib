import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Modal, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { config } from '../../config';

// Preserve the existing result URL while making inspection a separate touch action.
export function inspectResult(node) {
  const result = { href: undefined, label: 'View result details' };
  const visit = child => {
    if (Array.isArray(child)) return child.forEach(visit);
    if (!React.isValidElement(child)) return;
    if (child.type === 'a' && child.props.href) result.href = child.props.href;
    if (child.props['data-result-status']) result.label = child.props['aria-label'] || result.label;
    visit(child.props.children);
  };
  visit(node);
  return result;
}

function withoutLinks(node) {
  if (Array.isArray(node)) return React.Children.map(node, withoutLinks);
  if (!React.isValidElement(node)) return node;
  const children = withoutLinks(node.props.children);
  if (node.type === 'a') return <span key={node.key}>{children}</span>;
  return React.cloneElement(node, {}, children);
}

// One device-query listener is shared by all result cells.
let deviceQuery;
const subscribers = new Set();
const getDeviceQuery = () => deviceQuery || (deviceQuery = window.matchMedia('(hover: none), (pointer: coarse), (max-width: 767px)'));
const notifyDeviceChange = () => subscribers.forEach(notify => notify());
function subscribeDevice(notify) {
  const query = getDeviceQuery();
  if (!subscribers.size) query.addEventListener('change', notifyDeviceChange);
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
    if (!subscribers.size) query.removeEventListener('change', notifyDeviceChange);
  };
}

export default function ResultDetails({ children, overlay, tooltipId }) {
  const touch = useSyncExternalStore(subscribeDevice, () => getDeviceQuery().matches, () => false);
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [touch]);
  const { href, label } = inspectResult(children);
  if (!touch) return <OverlayTrigger placement="top" delay={config.tooltipDelayInMs}
    overlay={<Tooltip id={tooltipId} className="custom-tooltip p-0">{overlay}</Tooltip>}>
    <span className="d-inline-block">{children}</span>
  </OverlayTrigger>;
  return <>
    <button type="button" className="ib-result-details-trigger" aria-label={label}
      aria-haspopup="dialog" onClick={() => setOpen(true)}>{withoutLinks(children)}</button>
    <Modal show={open} onHide={() => setOpen(false)} centered scrollable className="ib-result-details-dialog">
      <Modal.Header closeButton><Modal.Title>Result details</Modal.Title></Modal.Header>
      <Modal.Body>{overlay}</Modal.Body>
      <Modal.Footer>
        <Button variant="light" onClick={() => setOpen(false)}>Close</Button>
        {href && <a className="btn btn-primary" href={href} target="_blank" rel="noopener noreferrer">Open logs ↗</a>}
      </Modal.Footer>
    </Modal>
  </>;
}
