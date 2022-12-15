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

import { Logger, RouteProvider, RouterFactory } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { WebsocketRequestHandler } from 'express-ws';
import { inject, injectable, named } from 'inversify';
import { ParsedQs } from 'qs';
import * as WebSocket from 'ws';

import { getValidatedModelUri } from '../client/uri-utils';
import { WSUpgradeRequest } from '../client/web-socket-utils';
import { SubscriptionManager } from '../services/subscription-manager';

/**
 * Query parameters for the `GET` request on the `subscribe` endpoint.
 */
interface SubscriptionQuery {
    /** The model URI to subscribe to. */
    modeluri: string;
    /** Whether the subscriber wishes to receive live validation diagnostics. */
    livevalidation: boolean;
    /** Optional session time-out, in milliseconds. */
    timeout?: number;

    /** Other query parameters passed through. */
    [key: string]: string | number | boolean;
}

/**
 * Custom routing of requests on the `/api/v2/validation` endpoint.
 * The primary such customization is an intercept of the `GET` request for validation
 * to delegate the implementation of custom validation providers.
 */
@injectable()
export class SubscriptionRoutes implements RouteProvider {
    @inject(Logger)
    @named(SubscriptionRoutes.name)
    protected readonly logger: Logger;

    @inject(SubscriptionManager)
    protected readonly subscriptionManager: SubscriptionManager;

    configureRoutes(routerFactory: RouterFactory): void {
        routerFactory('/api/v2/subscribe').ws('/', this.interceptSubscribeWS().bind(this));
    }

    /**
     * Create a WebSocket request handler for the `/api/v2/subscribe` endpoint to open WebSocket subscription sessions.
     *
     * @returns the subscription request handler
     */
    protected interceptSubscribeWS(): WebsocketRequestHandler {
        return (ws: WebSocket, req: WSUpgradeRequest) => {
            try {
                const subscriptionParams = parseQuery(req.query);
                const validatedModelUri = getValidatedModelUri(subscriptionParams.modeluri);
                if (!validatedModelUri) {
                    throw new Error('Validated Model URI is absent or empty.');
                }
                const originalURL = WSUpgradeRequest.getOriginalURL(req).split('?')[0];
                this.subscriptionManager.addSubscription(ws, originalURL, subscriptionParams);
            } catch (error) {
                ws.close(1001, error.message || 'Model URI parameter is absent or empty.');
                return;
            }
        };
    }
}

/**
 * Parse the subscription request query parameters coming from the downstream client to
 * extract details for local use and filter what is passed along to the upstream
 * subscription. This includes
 *
 * - enforcing required parameters, e.g. `modeluri`
 * - applying type coercion and defaults to known parameters, e.g. `livevalidation`
 * - filtering out query parameters that cannot be parsed from simple strings
 *
 * @param query the subscription request query parameters from downstream that we forward to the upstream server
 * @returns the parsed and filtered subscription query parameters
 */
function parseQuery(query: ParsedQs): SubscriptionQuery {
    return Object.keys(query).reduce(
        (acc, item) => {
            const param = parseQueryParam(query, item);
            if (param && !acc[item]) {
                acc[item] = param;
            }
            return acc;
        },
        {
            // Special-case these because the modeluri is required and the
            // other two are known parameters and have typed default values
            modeluri: parseQueryParam(query, 'modeluri'),
            livevalidation: parseQueryParam(query, 'livevalidation', false),
            timeout: parseQueryParam(query, 'timeout', 'number')
        }
    );
}

function parseQueryParam(query: ParsedQs, name: string, type?: 'string', defaultValue?: string): string | undefined;
function parseQueryParam(query: ParsedQs, name: string, type: 'number', defaultValue?: number): number | undefined;
function parseQueryParam(query: ParsedQs, name: string, defaultValue: number): number | undefined;
function parseQueryParam(query: ParsedQs, name: string, type: 'boolean', defaultValue?: boolean): boolean | undefined;
function parseQueryParam(query: ParsedQs, name: string, defaultValue: boolean): boolean | undefined;
function parseQueryParam(
    query: ParsedQs,
    name: string,
    typeOrDefaultValue?: 'string' | 'number' | 'boolean' | number | boolean,
    defaultValue?: string | number | boolean
): string | number | boolean | undefined {
    // Handle implicit-type overloads
    const typeOfTypeOrDefault = typeof typeOrDefaultValue;
    if (typeOfTypeOrDefault === 'undefined') {
        typeOrDefaultValue = 'string';
    } else if (typeOfTypeOrDefault === 'number' || typeOfTypeOrDefault === 'boolean') {
        defaultValue = typeOrDefaultValue;
        typeOrDefaultValue = typeOfTypeOrDefault;
    }

    const result = query[name];

    switch (typeOrDefaultValue) {
        case 'string':
            return typeof result === 'string' ? result.trim() : defaultValue;
        case 'number':
            return typeof result === 'string' ? Number.parseInt(result, 10) : defaultValue;
        case 'boolean': {
            if (!(typeof result === 'string')) {
                return defaultValue;
            }
            const canonical = result.toLowerCase();
            return canonical === undefined ? defaultValue : canonical === 'true' || canonical === 'yes';
        }
        default:
            throw new Error(`Unsupported type ${typeOrDefaultValue}`);
    }
}
