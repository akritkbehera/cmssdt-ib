import DeferredMatrix from '../common/DeferredMatrix';
import MatrixHelp from '../common/MatrixHelp';
import ResultFilter from "../common/ResultFilter";
import ComparisonContext from "../common/ComparisonContext";
import IconButton from "../common/IconButton";
import React, { PureComponent } from 'react';
import Commits from "./Commits";
import StatusLabels from "./StatusLabels";
import ComparisonTable from "./ComparisonTable";
import { Card } from "react-bootstrap";
import { checkIfCommitsAreEmpty, checkIfTableIsEmpty } from "../../Utils/processing";
import { FaEye, FaEyeSlash, FaCopy  } from 'react-icons/fa';
import { GoGitPullRequest } from "react-icons/go";

const copyText = (text) => {
    if (!text) return;

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text);
        return;
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        document.execCommand('copy');
    } finally {
        document.body.removeChild(textArea);
    }
};

class IBGroupFrame extends PureComponent {
    state = {
        showPullRequests: this.props.showPullRequests || false,
        copiedText: null,
        resultFilter: 'all',
        resultCounts: null
    };

    setResultFilter = resultFilter => this.setState({ resultFilter });
    updateResultCounts = resultCounts => this.setState({ resultCounts });

    copyToClipboard = (e, text) => {
        e.preventDefault();
        e.stopPropagation();

        copyText(text);

        this.setState({ copiedText: text });

        setTimeout(() => {
            this.setState({ copiedText: null });
        }, 1500);
    };

    componentDidUpdate(prevProps) {
        if (prevProps.showPullRequests !== this.props.showPullRequests) {
            this.setState({
                showPullRequests: this.props.showPullRequests
            });
        }
    }

    togglePullRequests = (e) => {
        e.stopPropagation();
        this.setState((prev) => ({
            showPullRequests: !prev.showPullRequests
        }));
    };

    getIbGroupType(IBGroup) {
        const firstIbFromList = IBGroup[0];
        const { isIB, next_ib } = firstIbFromList;

        if (isIB === true) return 'IB';
        if (isIB === false && next_ib === true) return 'nextIB';
        return 'fullBuild';
    }

    render() {
        const { IBGroup, releaseQue, isCollapsed, onToggleCollapse } = this.props;
        const { showPullRequests } = this.state;

        const firstIbFromList = IBGroup[0];
        if (!firstIbFromList) {
            return <div><h1>Error: IB group is empty</h1></div>;
        }

        let statusLabels = null;
        let comparisonTable = null;
        let commitPanelProps = {};
        let panelHeader = null;
        let showOnlyIbTag = false;

        const ibGroupType = this.getIbGroupType(IBGroup);
        const isNextIB = ibGroupType === 'nextIB';

        const ibTagDropdown = StatusLabels.renderIBTag(IBGroup, ibGroupType);

        switch (ibGroupType) {
            case 'IB': {
                const isIBGroupTableEmpty = checkIfTableIsEmpty({
                    fieldsToCheck: ['builds', 'utests', 'relvals', 'addons', 'dupDict'],
                    IBGroup
                });

                const isCommitsEmpty = checkIfCommitsAreEmpty({
                    IBGroup
                });

                if (isCommitsEmpty && isIBGroupTableEmpty) {
                    return null;
                }

                panelHeader = firstIbFromList.release_name;

                if (!isIBGroupTableEmpty) {
                    comparisonTable = (
                        <ComparisonTable
                            data={IBGroup}
                            comparisons={this.props.comparisons}
                            resultFilter={this.state.resultFilter}
                            onCountsChange={this.updateResultCounts}
                            releaseQue={releaseQue}
                        />
                    );
                }

                commitPanelProps = {
                    defaultExpanded: true
                };
                break;
            }

            case 'nextIB':
                showOnlyIbTag = true;
                panelHeader = 'nextIB';
                break;

            case 'fullBuild':
                showOnlyIbTag = true;
                panelHeader = firstIbFromList.release_name;
                break;

            default:
                console.error("wrong case: " + ibGroupType);
        }

        statusLabels = (
            <StatusLabels
                IBGroup={IBGroup}
                comparisons={this.props.comparisons}
                ibGroupType={ibGroupType}
                showOnlyIbTag={showOnlyIbTag}
            />
        );

        return (
            <Card data-pr-visible={showPullRequests} className={`ib-release-panel ${isNextIB ? "ib-release-panel--upcoming" : ""}`}>
                <Card.Header
                    className="ib-release-panel-header"
                    onClick={isNextIB && !showPullRequests ? undefined : onToggleCollapse}
                >
                    {isNextIB ? (
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '10px',
                                    flexWrap: 'wrap',
                                    flex: 1,
                                    minWidth: 0
                                }}
                            >
                                <IconButton
                                    type="button"
                                    onClick={this.togglePullRequests}
                                    title={showPullRequests ? "Hide Pull Requests" : "Show Pull Requests"}
                                    aria-label={showPullRequests ? "Hide Pull Requests" : "Show Pull Requests"}
                                    aria-pressed={showPullRequests}
                                    active={showPullRequests}
                                >
                                    <GoGitPullRequest size={16} />
                                </IconButton>

                                <strong>{panelHeader}</strong>

                                <span
                                    style={{
                                        fontSize: "var(--ui-type-caption)",
                                        fontWeight: 700,
                                        padding: '3px 10px',
                                        borderRadius: '999px',
                                        background: '#2563eb',
                                        color: '#ffffff'
                                    }}
                                >
                                    Upcoming
                                </span>

                                <div
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => e.stopPropagation()}
                                >
                                    {ibTagDropdown}
                                </div>
                            </div>
                        ) : (
                        <>
                            <div className="ib-build-actions"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    minWidth: 0
                                }}
                            >
                                <IconButton
                                    type="button"
                                    onClick={this.togglePullRequests}
                                    title={showPullRequests ? "Hide Pull Requests" : "Show Pull Requests"}
                                    aria-label={showPullRequests ? "Hide Pull Requests" : "Show Pull Requests"}
                                    aria-pressed={showPullRequests}
                                    active={showPullRequests}
                                >
                                    <GoGitPullRequest size={16} />
                                </IconButton>

                                <div className="ib-build-identity">
                                  <strong>{panelHeader}</strong>
                                  {panelHeader.match(/\d{4}-\d{2}-\d{2}-\d{4}/) && <span className="ib-build-timestamp" title="Timestamp from build tag; timezone is not provided by the dataset">{panelHeader.match(/\d{4}-\d{2}-\d{2}-\d{4}/)[0].replace(/-(\d{2})(\d{2})$/, ' · $1:$2')} · tag time (zone unspecified)</span>}
                                </div>
                                 <IconButton
                                    type="button"
                                    onClick={(e) => this.copyToClipboard(e, panelHeader)}
                                    title={`Copy ${panelHeader}`}
                                    aria-label={`Copy ${panelHeader}`}

                                >
                                    {this.state.copiedText === panelHeader ? (
                                        <span style={{ fontSize: "var(--ui-type-caption)" }}>✓</span>
                                    ) : (
                                        <FaCopy size={12} />
                                    )}
                                </IconButton>
                            </div>

                            <MatrixHelp compact />
                            <ComparisonContext compact builds={IBGroup} comparisons={this.props.comparisons || new Map()} />
                            {comparisonTable && !isCollapsed && <div className="ib-header-result-filter"
                                title="Test results filter" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                                <ResultFilter filter={this.state.resultFilter} counts={this.state.resultCounts} onChange={this.setResultFilter} />
                            </div>}

                            <button type="button" className="ib-collapse-toggle"
                                onClick={event => { event.stopPropagation(); onToggleCollapse(); }}
                                aria-expanded={!isCollapsed}
                                aria-label={isCollapsed ? `Expand ${panelHeader}` : `Collapse ${panelHeader}`}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#1d4ed8',
                                    fontSize: "var(--ui-type-heading)",
                                    flexShrink: 0
                                }}
                            >
                                {isCollapsed ? <FaEyeSlash /> : <FaEye />}<span className="ib-collapse-label">{isCollapsed ? 'Expand' : 'Collapse'}</span>
                            </button>
                        </>
                    )}
                    {isNextIB && showPullRequests && <button type="button" className="ib-collapse-toggle"
                      aria-expanded={!isCollapsed} aria-label={isCollapsed ? `Expand ${panelHeader}` : `Collapse ${panelHeader}`}
                      onClick={event => { event.stopPropagation(); onToggleCollapse(); }}>
                      {isCollapsed ? 'Expand' : 'Collapse'}
                    </button>}
                </Card.Header>
                <ComparisonContext builds={IBGroup} comparisons={this.props.comparisons || new Map()} />

                {!isCollapsed && (!isNextIB || showPullRequests) && (
                    <Card.Body className="ib-release-panel-body">
                        {statusLabels}
                        {comparisonTable && <DeferredMatrix>{comparisonTable}</DeferredMatrix>}

                        {showPullRequests && (
                            <Commits
                                commitPanelProps={{
                                    ...commitPanelProps,
                                    defaultExpanded: true
                                }}
                                data={IBGroup}
                                expandAllCommits={true}
                                targetPrNumber={this.props.targetPrNumber}
                            />
                        )}
                    </Card.Body>
                )}
            </Card>
        );
    }
}

IBGroupFrame.defaultProps = {
    showPullRequests: false
};

export default IBGroupFrame;
