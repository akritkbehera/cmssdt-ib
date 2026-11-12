import React, { createContext, useReducer, useContext, useEffect } from "react";
import { config } from "../config";
import { extractInfoFromArchs } from "../Utils/processing";
import { getMultipleFiles } from "../Utils/ajax";

const { urls, colorCoding } = config;

// -----------------------------
// Action Types
// -----------------------------
export const ShowArchActionTypes = {
  LOAD_ARCHS: "LOAD_ARCHS",
  TOGGLE_ARCH: "TOGGLE_ARCH",
  SET_ACTIVE_ARCHS: "SET_ACTIVE_ARCHS",
};

// -----------------------------
// Initial State
// -----------------------------
const initialState = {
  emptyConfig: { os: [], cpu: [], compiler: [] },
  queConfig: {},
  emptyColors: Object.freeze({}),
};

// -----------------------------
// Reducer
// -----------------------------
function showArchReducer(state, action) {
  switch (action.type) {
    case ShowArchActionTypes.LOAD_ARCHS:
      return { ...state, queConfig: action.payload };

    case ShowArchActionTypes.SET_ACTIVE_ARCHS: {
      const { releaseQue, field, activeValues } = action.payload;
      const previous = state.queConfig[releaseQue];
      if (!previous) return state;
      const newQueConfig = {...state.queConfig, [releaseQue]:{...previous, activeArchs:{...previous.activeArchs, [field]:activeValues}}};
      return { ...state, queConfig: newQueConfig };
    }

    case ShowArchActionTypes.TOGGLE_ARCH:
      // implement toggle logic if needed
      return state;

    default:
      return state;
  }
}

// -----------------------------
// Context
// -----------------------------
const ShowArchContext = createContext();

// -----------------------------
// Provider
// -----------------------------
export function ShowArchProvider({ children, structure: initialStructure }) {
  const [state, dispatch] = useReducer(showArchReducer, initialState);

  // Load data initially
  useEffect(() => {
    getMultipleFiles({
      fileUrlList: initialStructure ? [urls.latestIBSummary] : [urls.releaseStructure, urls.latestIBSummary],
      onSuccessCallback: function (responseList) {
        const structureData = initialStructure || responseList[0].data;
        const ibSummary = responseList[initialStructure ? 0 : 1].data;
        const { all_prefixes, all_release_queues } = structureData;
        const { prod_archs } = ibSummary;

        let archListByRelease = {},
          configState = {};

        // Collect archs per release queue
        all_release_queues.forEach((que) => {
          if (!ibSummary[que]) return;
          archListByRelease[que] = Object.keys(ibSummary[que]);
        });

        all_prefixes.forEach((prefix) => {
          const releaseFlavors = structureData[prefix];
          releaseFlavors.forEach((flavor) => {
            if (!configState[prefix]) configState[prefix] = [];
            if (!archListByRelease[flavor]) return;
            configState[prefix] = configState[prefix].concat(
              archListByRelease[flavor]
            );
          });
        });

        // Build queConfig
        all_prefixes.forEach((que) => {
          if (!prod_archs[que]) return;
          if (!configState[que][0] && prod_archs[que]) configState[que][0] = prod_archs[que];

          const results = extractInfoFromArchs(configState[que]);
          const [os, cpu, compiler] = prod_archs[que].split("_");

          configState[que] = {
            allArchs: { ...results },
            activeArchs: { ...results },
            colorCoding: {},
          };

          const colorFunction = (prodField) => {
            let counter = 0;
            return (field) => {
              const { prodColor, alternatingColors, defaultColor } = colorCoding;
              const queColorConfig = configState[que].colorCoding;
              if (field === prodField) {
                queColorConfig[field] = prodColor;
              } else if (counter < alternatingColors.length) {
                queColorConfig[field] = alternatingColors[counter];
                counter++;
              } else {
                queColorConfig[field] = defaultColor;
              }
            };
          };

          results.os.map(colorFunction(os));
          results.cpu.map(colorFunction(cpu));
          results.compiler.map(colorFunction(compiler));
        });

        dispatch({ type: ShowArchActionTypes.LOAD_ARCHS, payload: configState });
      },
    });
  }, [initialStructure]);

  // -----------------------------
  // Helper functions for components
  // -----------------------------
  const getAllArchsForQue = (releaseQue) => {
    if (!state.queConfig[releaseQue]) return state.emptyConfig;
    return state.queConfig[releaseQue].allArchs || state.emptyConfig;
  };

  const getActiveArchsForQue = (releaseQue) => {
    if (!state.queConfig[releaseQue]) return state.emptyConfig;
    return state.queConfig[releaseQue].activeArchs || state.emptyConfig;
  };

  const setActiveArchsForQue = ({ field, activeValues, releaseQue }) => {
    dispatch({
      type: ShowArchActionTypes.SET_ACTIVE_ARCHS,
      payload: { releaseQue, field, activeValues },
    });
  };

  const getColorsSchemeForQue = (releaseQue) => {
    if (!state.queConfig[releaseQue]) return state.emptyColors;
    return state.queConfig[releaseQue].colorCoding || state.emptyColors;
  };

  return (
    <ShowArchContext.Provider
      value={{
        state,
        dispatch,
        getAllArchsForQue,
        getActiveArchsForQue,
        setActiveArchs: setActiveArchsForQue,
        getColorsSchemeForQue,
      }}
    >
      {children}
    </ShowArchContext.Provider>
  );
}

// -----------------------------
// Custom Hook
// -----------------------------
export function useShowArch() {
  return useContext(ShowArchContext);
}
