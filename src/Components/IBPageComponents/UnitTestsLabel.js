import React from 'react';
import TestResultDropdown from '../common/TestResultDropdown';
export const UnitTestsLabel = ({tests={}, type_name, ib, comparisons}) =>
  <TestResultDropdown tests={tests} type={type_name} kind="qa" ib={ib} comparisons={comparisons}/>;
