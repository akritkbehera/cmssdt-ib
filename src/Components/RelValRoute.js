import React from 'react';
import RelValLayoutWrapper from './RelValLayoutWrapper';
import {RelValProvider} from '../Stores/RelValStore';
import {CommandProvider} from '../context/CommandContext';
import {ExitCodeProvider} from '../context/ExitCodeContext';

export default function RelValRoute() {
  return <ExitCodeProvider><CommandProvider><RelValProvider>
    <RelValLayoutWrapper />
  </RelValProvider></CommandProvider></ExitCodeProvider>;
}
