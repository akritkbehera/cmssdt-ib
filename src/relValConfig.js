import * as React from "react";

export const LABEL_COLOR = {
    PASSED_COLOR: 'rgb(92, 184, 92)',
    PASSED_WARNINGS_COLOR: 'rgb(92, 145, 92)',
    PASSED_ERRORS_COLOR: 'rgb(230, 188, 99)',
    FAILED_COLOR: 'rgb(217, 83, 79)',
    NOT_RUN_COLOR: 'rgb(153, 153, 153)',
    DAS_ERROR_COLOR: 'rgb(255, 153, 204)',
};

export const LABELS_TEXT = {
    PASSED: 'Passed',
    FAILED: 'Failed',
    NOTRUN: 'NotRun',
    DAS_ERROR: 'DAS-Err',
    TIMEOUT: 'TimeOut',
    STARTED: 'Started'
};

export const STATUS_ENUM = {
    PASSED: 'passed',
    FAILED: 'failed',
    KNOWN_FAILED: 'known_failed'
};

export const STATUS_ENUM_LIST = [
    STATUS_ENUM.FAILED, STATUS_ENUM.KNOWN_FAILED, STATUS_ENUM.PASSED
];

export const RELVAL_STATUS_ENUM = {
    PASSED: 'PASSED',
    FAILED: 'FAILED',
    DAS_ERROR: 'DAS_ERROR',
    TIMEOUT: 'TIMEOUT',
    NOTRUN: 'NOTRUN'
};

// Default to the local SDT tree; GitHub Pages builds use the public CMS mirror.
const DATA_PATH = (
  import.meta.env.VITE_CMS_PUBLIC_DATA_BASE_URL || '/SDT/public/cms-sw.github.io/data'
).replace(/\/+$/, '');
const CMSSDT_SERVER = import.meta.env.VITE_CMSSDT_SERVER || '';

export const urls = {
    exitcodes: "https://cms-sw.github.io/exitcodes.json",
    
    // Available results
    RelvalsAvailableResults: `${DATA_PATH}/RelvalsAvailableResults.json`,
    
    // Data directory for specific que/date
    relValDataDir: `${DATA_PATH}/`,
    
    // Individual relval results
    relValsResult: (arch, date, que, flavor, type, name) =>
        type && type !== ""
          ? `${DATA_PATH}/relvals/${arch}/${date}/${type}/${name}/${que}_${flavor}.json`
          : `${DATA_PATH}/relvals/${arch}/${date}/${que}_${flavor}.json`,
    
    // Command hashes
    relValWorkFlowToIdHash: (arch, date, que, flavor, type, name) =>
        type && type !== ""
          ? `${DATA_PATH}/commands/${arch}/${date}/${type}/${name}/${que}_${flavor}.json`
          : `${DATA_PATH}/commands/${arch}/${date}/${que}_${flavor}.json`,
    
    // Commands by hash
    relValCmd: (digit1, digitsRest) => 
        `${DATA_PATH}/commands/objs/${digit1}/${digitsRest}`,
    
    // Log viewer URLs - these still need to go to CERN
    relValLog: (arch, ib, workflowID, workflowName, filename, type, name) =>
        type && type !== ""
          ? `${CMSSDT_SERVER}/SDT/cgi-bin/logreader/${arch}/${ib}/${type}/${name}/pyRelValMatrixLogs/run/${workflowID}_${workflowName}/${filename}`
          : `${CMSSDT_SERVER}/SDT/cgi-bin/logreader/${arch}/${ib}/pyRelValMatrixLogs/run/${workflowID}_${workflowName}/${filename}`
};

const _legendConf = [
    {color: LABEL_COLOR.PASSED_COLOR, code: LABELS_TEXT.PASSED, text: 'Passed without error or warning messages'},
    {color: LABEL_COLOR.PASSED_ERRORS_COLOR, code: LABELS_TEXT['PASSED'], text: 'Passed with error messages'},
    {color: LABEL_COLOR.NOT_RUN_COLOR, code: LABELS_TEXT['NOTRUN'], text: 'Not run'},
    {color: LABEL_COLOR.PASSED_WARNINGS_COLOR, code: LABELS_TEXT['PASSED'], text: 'Passed with warning messages'},
    {color: LABEL_COLOR.FAILED_COLOR, code: LABELS_TEXT['FAILED'], text: 'Failed'},
    {color: LABEL_COLOR.DAS_ERROR_COLOR, code: LABELS_TEXT['DAS_ERROR'], text: 'DAS error'},
    {color: LABEL_COLOR.PASSED_COLOR, code: "OtherCMS", text: 'Known failed', glyphicon: "glyphicon-eye-open"},
];

export const legend = [_legendConf.map(i => {
    let renderedGlyphicon = i.glyphicon ? (<span className={"glyphicon " + i.glyphicon}/> ): null;
    return (
        <p key={`${i.code}-${i.text}`}>
            <span style={{backgroundColor: i.color}} className="label">{i.code} {renderedGlyphicon}</span> {i.text} 
        </p>
    )
})];
