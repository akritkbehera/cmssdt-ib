import React from 'react';
import TestResultDropdown from '../common/TestResultDropdown';
export const RelvalsLabel = ({tests={}, type_name, ib, comparisons}) =>
  <TestResultDropdown tests={tests} type={type_name} kind="relvals" ib={ib} comparisons={comparisons}/>;
