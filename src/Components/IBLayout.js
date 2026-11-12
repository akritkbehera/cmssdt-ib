import {memoizeLast} from '../Utils/memoizeLast';
import DashboardDensity from "./common/DashboardDensity";
import React, { Component } from 'react';
import _ from 'underscore';
import ToggleButtonGroupControlled from "./TogglesShowIBFlawors";
import IBGroups from './IBPageComponents/IBGroups';
import { config } from '../config';
import Navigation from "./Navigation";
import TogglesShowArchs from "./TogglesShowArchs";
import { getMultipleFiles } from "../Utils/ajax";
import { useShowArch } from "../context/ShowArchContext";

const { urls } = config;

/** Keep IB JSON fresh for 15 minutes */
const IB_MEMORY_TTL_MS = 15 * 60 * 1000;
const ibDataCache = {};
/** Preference setting for users for opened/Cloed PR's */
const PR_PREF_KEY = "cms_ib_show_all_prs";
function isFreshCache(entry, ttlMs) {
    if (!entry || !entry.cachedAt) return false;
    return Date.now() - entry.cachedAt < ttlMs;
}

const IBGroupsWithArch = React.memo((props) => {
    const { getActiveArchsForQue } = useShowArch();
    const activeArchs = getActiveArchsForQue(props.releaseQue);

    return <IBGroups {...props} activeArchs={activeArchs} />;
});

class IBLayout extends Component {
    constructor(props) {
        super(props);

        this.boundGetNavigationHeight = this.getNavigationHeight.bind(this);
        this.lastRequestedIbListSignature = "";
        this._isMounted = false;
        this.requestGeneration = 0;

        this.state = {
            nameList: [],
            nameListToShow: [],
            dataList: [],
            all_release_queues: props.structure?.all_release_queues || [],
            toLinks: props.toLinks || [],
            navigationHeight: 50,
            releaseQue: props.params?.prefix || "",
            loading: false,
            error: null,
            isUnauthorized: false,
            isNetworkError: false,
            showAllPullRequests: localStorage.getItem(PR_PREF_KEY) === "true"
        };
    }
    toggleAllPullRequests = () => {
        this.setState((prevState) => {
            const next = !prevState.showAllPullRequests;
            localStorage.setItem(PR_PREF_KEY, String(next));  

            return {
                showAllPullRequests: next
            };
        });
    };
    
    componentDidMount() {
        this._isMounted = true;
        this.updateState(this.props);
        window.addEventListener('resize', this.boundGetNavigationHeight);
        this.getNavigationHeight();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.params?.prefix !== this.props.params?.prefix) {
            this.updateState(this.props);
        }
    }

    componentWillUnmount() {
        this._isMounted = false;
        this.requestGeneration++;
        this.pendingBatch?.abort();
        window.removeEventListener('resize', this.boundGetNavigationHeight);
    }

    updateState(props) {
        const releaseQue = props.params?.prefix || "";
        const structure = props.structure || {};
        const IbFlavorList = _.find(structure, (val, key) => key === releaseQue) || [];

        this.setState(
            (prevState) => {
                const nextState = {};
                let hasChanges = false;

                if (prevState.releaseQue !== releaseQue) {
                    nextState.releaseQue = releaseQue;
                    hasChanges = true;
                }

                if (prevState.nameList !== IbFlavorList) {
                    nextState.nameList = IbFlavorList;
                    hasChanges = true;
                }

                return hasChanges ? nextState : null;
            },
            () => {
                this.getData(IbFlavorList);
            }
        );
    }

    getData(ibList) {
        const generation = ++this.requestGeneration;
        this.pendingBatch?.abort();
        this.pendingBatch = new AbortController();
        if (!ibList || ibList.length === 0) {
            this.setState((prevState) => {
                const updates = {
                    dataList: [],
                    loading: false,
                    error: null,
                    isUnauthorized: false,
                    isNetworkError: false
                };

                const isSame =
                    prevState.dataList.length === 0 &&
                    prevState.loading === false &&
                    prevState.error === null &&
                    prevState.isUnauthorized === false &&
                    prevState.isNetworkError === false;

                return isSame ? null : updates;
            });
            return;
        }

        const listSignature = JSON.stringify(ibList);
        this.lastRequestedIbListSignature = listSignature;

        const cachedData = [];
        const missingNames = [];

        ibList.forEach((name) => {
            if (isFreshCache(ibDataCache[name], IB_MEMORY_TTL_MS)) {
                cachedData.push(ibDataCache[name].data);
            } else {
                missingNames.push(name);
            }
        });

        // If all data is already available from cache, show it immediately
        if (missingNames.length === 0) {
            this.setState((prevState) => {
                const sameLength = prevState.dataList.length === cachedData.length;
                const sameRefOrder = sameLength && prevState.dataList.every((item, index) => item === cachedData[index]);

                const dataChanged = !sameRefOrder;
                const stateNeedsReset =
                    prevState.loading !== false ||
                    prevState.error !== null ||
                    prevState.isUnauthorized !== false ||
                    prevState.isNetworkError !== false;

                if (!dataChanged && !stateNeedsReset) return null;

                return {
                    dataList: cachedData,
                    loading: false,
                    error: null,
                    isUnauthorized: false,
                    isNetworkError: false
                };
            });
            return;
        }

        // Show cached partial data immediately while remaining files are loading
        this.setState((prevState) => {
            const sameLength = prevState.dataList.length === cachedData.length;
            const sameRefOrder =
                sameLength &&
                prevState.dataList.every((item, index) => item === cachedData[index]);

            return {
                dataList: sameRefOrder ? prevState.dataList : cachedData,
                loading: true,
                error: null,
                isUnauthorized: false,
                isNetworkError: false
            };
        });

        const receive = responsesList => {
            if (!this._isMounted || generation !== this.requestGeneration) return;
            responsesList.forEach((response, index) => {
                if (response?.data) ibDataCache[missingNames[index]] = {data:response.data, cachedAt:Date.now()};
            });
            const mergedData=ibList.map(name=>ibDataCache[name]?.data).filter(Boolean);
            this.setState(previous => previous.dataList.length===mergedData.length && previous.dataList.every((item,i)=>item===mergedData[i])
                ? null : {dataList:mergedData});
        };
        getMultipleFiles({
            fileUrlList: missingNames.map((name) => urls.dataDir + name + '.json'),
            signal: this.pendingBatch.signal,
            onProgress: receive,
            onSuccessCallback: (responsesList) => {
                if (!this._isMounted || generation !== this.requestGeneration) return;

                responsesList.forEach((response, index) => {
                    const name = missingNames[index];
                    if (response && response.data) {
                        ibDataCache[name] = {
                            data: response.data,
                            cachedAt: Date.now()
                        };
                    }
                });

                const mergedData = ibList
                    .map((name) => ibDataCache[name]?.data)
                    .filter((item) => item);

                this.setState((prevState) => {
                    const sameLength = prevState.dataList.length === mergedData.length;
                    const sameRefOrder =
                        sameLength &&
                        prevState.dataList.every((item, index) => item === mergedData[index]);

                    const dataChanged = !sameRefOrder;
                    const stateNeedsReset =
                        prevState.loading !== false ||
                        prevState.error !== null ||
                        prevState.isUnauthorized !== false ||
                        prevState.isNetworkError !== false;

                    if (!dataChanged && !stateNeedsReset) return null;

                    return {
                        dataList: mergedData,
                        loading: false,
                        error: null,
                        isUnauthorized: false,
                        isNetworkError: false
                    };
                });
            },
            onErrorCallback: (error) => {
                if (!this._isMounted || generation !== this.requestGeneration) return;

                const status = error?.response?.status;
                const isUnauthorized = status === 401;
                const isNetworkError = !error?.response;

                this.setState({
                    loading: false,
                    error,
                    isUnauthorized,
                    isNetworkError
                });
            }
        }).catch(() => { /* Request errors are represented by the callbacks; cancellation is silent. */ });
    }

    updateNameListToShow = (newNameList) => {
        this.setState((prevState) => {
            const prevSignature = JSON.stringify(prevState.nameListToShow || []);
            const nextSignature = JSON.stringify(newNameList || []);

            if (prevSignature === nextSignature) return null;
            return { nameListToShow: newNameList };
        });
    };

    visibleData = memoizeLast((dataList, names) => !names?.length ? dataList : dataList.filter(item => names.includes(item.release_name)));

    filterListToShow() {
        const { nameListToShow, dataList } = this.state;
        return this.visibleData(dataList, nameListToShow);
    }

    getNavigationHeight() {
        const navigationHeight = document.getElementById('navigation')?.clientHeight || 50;

        this.setState((prevState) => {
            if (prevState.navigationHeight === navigationHeight) return null;
            return { navigationHeight };
        });
    }

    getTopPadding() {
        return this.state.navigationHeight + 4;
    }

    render() {
        const { releaseQue, toLinks, nameList, all_release_queues, loading, error, isUnauthorized, isNetworkError, showAllPullRequests } = this.state;

        const filteredData = this.filterListToShow();

        return (
            <div className="container-fluid px-0" >
                <Navigation
                    toLinks={toLinks}
                    showAllPullRequests={showAllPullRequests}
                    onToggleAllPullRequests={this.toggleAllPullRequests}
                    flaworControl={
                        <ToggleButtonGroupControlled
                            nameList={nameList}
                            initSelections={all_release_queues}
                            callbackToParent={this.updateNameListToShow}
                        />
                    }
                    archControl={<TogglesShowArchs releaseQue={releaseQue} />}
                />

                <DashboardDensity release={releaseQue}>
                <IBGroupsWithArch
                    data={filteredData}
                    comparisonData={this.state.dataList}
                    releaseQue={releaseQue}
                    showAllPullRequests={showAllPullRequests}
                    loading={loading}
                    error={error}
                    isUnauthorized={isUnauthorized}
                    isNetworkError={isNetworkError}
                    loadingText={`Loading ${releaseQue || 'release'} builds...`}
                />
                </DashboardDensity>
            </div>
        );
    }
}

export default IBLayout;