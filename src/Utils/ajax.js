import {fetchBatch} from './fetchBatch.js';
import axios from "axios";
import wrapper from 'axios-cache-plugin';

let httpWrapper = wrapper(axios, {
    maxCacheSize: 200,
    ttl: 15 * 60 * 1000 // 15 min
});

httpWrapper.__addFilter(/\.json/);

let unauthorizedEventSent = false;

function handleHttpError(error, onErrorCallback) {
    console.error(error);

    const status = error?.response?.status;

    if (status === 401) {
        if (!unauthorizedEventSent) {
            unauthorizedEventSent = true;

            window.dispatchEvent(
                new CustomEvent("app:unauthorized", {
                    detail: {
                        message: "Your session has expired. Please refresh the page and sign in again.",
                        status
                    }
                })
            );

            setTimeout(() => {
                unauthorizedEventSent = false;
            }, 5000);
        }
    }

    if (typeof onErrorCallback === "function") {
        onErrorCallback(error);
    }

    throw error;
}

export function getSingleFile({ fileUrl, onSuccessCallback, onErrorCallback }) {
    return requestFile(fileUrl)
        .then((response) => {
            if (typeof onSuccessCallback === "function") {
                onSuccessCallback(response);
            }
            return response;
        })
        .catch((error) => handleHttpError(error, onErrorCallback));
}

// Concurrent consumers share the same in-flight request, including structure loads.
const inFlight = new Map();
function requestFile(url) {
    if (!inFlight.has(url)) {
        const request = httpWrapper.get(url).finally(() => inFlight.delete(url));
        inFlight.set(url, request);
    }
    return inFlight.get(url);
}

export function getMultipleFiles({fileUrlList = [], onSuccessCallback = () => {}, onErrorCallback, onProgress, concurrency = 4, signal}) {
    const urls = Array.isArray(fileUrlList) ? fileUrlList : [];
    return fetchBatch(urls, requestFile, {concurrency, onProgress, signal})
        .then(results => { onSuccessCallback(results); return results; })
        .catch(error => {
            if (error?.name === 'AbortError') throw error;
            return handleHttpError(error, onErrorCallback);
        });
}
