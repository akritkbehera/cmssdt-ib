import React from 'react';
import { Button } from 'react-bootstrap';

/** Shared target size, keyboard focus and accessible name for icon actions. */
export default function IconButton({ title, label = title, active = false, className = '', children, ...props }) {
  return (
    <Button
      {...props}
      type="button"
      variant={active ? 'primary' : 'outline-secondary'}
      className={`ib-icon-button ${className}`.trim()}
      title={title || label}
      aria-label={label}
    >
      {children}
    </Button>
  );
}
