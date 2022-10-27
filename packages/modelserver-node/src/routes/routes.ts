/********************************************************************************
 * Copyright (c) 2022 STMicroelectronics.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0, or the MIT License which is
 * available at https://opensource.org/licenses/MIT.
 *
 * SPDX-License-Identifier: EPL-2.0 OR MIT
 *******************************************************************************/
import { AnyObject, Format, ModelUpdateResult } from '@eclipse-emfcloud/modelserver-client';
import { Response } from 'express';
import { ServerResponse } from 'http';

/**
 * Return an uri related error response to the upstream client.
 *
 * @param res the upstream response stream
 * @returns a function that takes an uri related error and reports it to the upstream client
 */
export function handleUriError(res: ServerResponse): (error: any) => void {
    return error => respondUriError(res, error);
}

/**
 * Return an uri related error response to the upstream client.
 *
 * @param res the upstream response stream
 * @param error the uri related error to report
 */
export function respondUriError(res: ServerResponse, error: any): boolean {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    if (error.stack) {
        res.write(JSON.stringify({ error: error.toString(), stackTrace: error.stack }));
    } else {
        res.write(JSON.stringify({ error: error.toString() }));
    }
    res.end();
    return false;
}

/**
 * Return an error response to the upstream client.
 *
 * @param res the upstream response stream
 * @returns a function that takes an error and reports it to the upstream client
 */
export function handleError(res: ServerResponse): (error: any) => void {
    return error => respondError(res, error);
}

/**
 * Return an error response to the upstream client.
 *
 * @param res the upstream response stream
 * @param error the error to report
 */
export function respondError(res: ServerResponse, error: any): boolean {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    if (error.stack) {
        res.write(JSON.stringify({ error: error.toString(), stackTrace: error.stack }));
    } else {
        res.write(JSON.stringify({ error: error.toString() }));
    }
    res.end();
    return false;
}

/**
 * Relay a downstream response to the upstream client.
 *
 * @param upstream the upstream response stream
 * @returns a function that relays the downstream response result to the upstream client
 */
export function relay(
    upstream: Response<any, Record<string, any>>
): <T extends boolean | string | ModelUpdateResult | AnyObject>(downstream: T) => T {
    const writeHead = (isError = false): unknown =>
        upstream.writeHead(isError ? 500 : 200, isError ? 'Internal Server Error' : 'OK', { 'Content-Type': 'application/json' });

    return downstream => {
        if (typeof downstream === 'boolean') {
            if (downstream) {
                writeHead();
                upstream.write(JSON.stringify({ type: 'success', data: 'The requested operation succeeded.' }));
            } else {
                writeHead(true);
                upstream.write(JSON.stringify({ type: 'error', error: 'An unknown error occurred.' }));
            }
            upstream.end();
        } else if (typeof downstream === 'string') {
            writeHead();
            upstream.write(JSON.stringify({ type: 'success', data: downstream }));
        } else {
            if (downstream instanceof Error) {
                // Return only properties of the error that we expect (others may leak private information)
                const safeError = Object.keys(downstream)
                    .filter(k => k in ['message', 'stack'])
                    .reduce((acc, k) => ({ ...acc, [k]: downstream[k] }), {});
                writeHead(true);
                upstream.write(JSON.stringify({ type: 'error', data: safeError }));
            } else {
                writeHead();
                upstream.write(JSON.stringify({ type: 'success', data: downstream }));
            }
        }

        upstream.end();
        return downstream;
    };
}

/**
 * Obtain a valid format string from the given `format`.
 *
 * @param format a free-form format string
 * @returns the `format` if it is a valid `Format`, otherwise `'json-v2'`
 */
export function validateFormat(format?: string): Format {
    if (!format) {
        return 'json-v2';
    }

    const normalized = format.toLowerCase();
    switch (normalized) {
        case 'json':
        case 'json-v2':
        case 'xml':
            return normalized;
        default:
            return 'json-v2';
    }
}
