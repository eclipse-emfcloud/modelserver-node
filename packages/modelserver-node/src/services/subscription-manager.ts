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

import { Diagnostic, MessageType, ModelServerMessage } from '@eclipse-emfcloud/modelserver-client';
import { Logger } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { EventEmitter } from 'events';
import { inject, injectable, named } from 'inversify';
import { stringify as unparseQuery } from 'qs';
import * as WebSocket from 'ws';

import { UpstreamConnectionConfig } from '../client/model-server-client';
import { handleClose, handleError, JSONSocket } from '../client/web-socket-utils';

/**
 * Query parameters for the `GET` request on the `subscribe` endpoint.
 */
export interface SubscriptionQuery {
    /** The model URI to subscribe to. */
    modeluri: string;
    /** Whether the subscriber wishes to receive live validation diagnostics. */
    livevalidation: boolean;
    /** Optional session time-out, in milliseconds. */
    timeout?: number;

    /** Other query parameters passed through. */
    [key: string]: string | number | boolean;
}

type Client = JSONSocket & { options?: SubscriptionQuery };

export type EventType = 'subscribed' | 'unsubscribed';

@injectable()
export class SubscriptionManager {
    @inject(Logger)
    @named(SubscriptionManager.name)
    protected readonly logger: Logger;

    @inject(UpstreamConnectionConfig)
    protected readonly upstreamConnectionConfig: UpstreamConnectionConfig;

    /** Map of downstream (client) socket to upstream (Upstream Model Server) socket. */
    protected readonly subscriptions: Map<Client, JSONSocket> = new Map();

    protected readonly eventEmitter = new EventEmitter();

    addSubscription(client: WebSocket, endpoint: string, params: SubscriptionQuery): JSONSocket {
        // Drop the livevalidation option from the upstream subscription because we handle
        // live validation broadcasts in the Model Server node.js layer
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { livevalidation, ...upstreamParams } = params;
        const { serverPort, hostname } = this.upstreamConnectionConfig;
        const url = `ws://${hostname}:${serverPort}${endpoint}?${unparseQuery(upstreamParams)}`;
        this.logger.info(`Forwarding subscriptions to ${url}`);

        const downstream: Client = new JSONSocket(client);
        downstream.options = params;
        let upstream: JSONSocket;

        try {
            upstream = new JSONSocket(new WebSocket(url));

            this.subscriptions.set(downstream, upstream);

            upstream.onMessage(msg => downstream.send(msg));
            downstream.onMessage(msg => upstream.send(msg));

            // Clean-up on close
            const cleanupHandler: () => void = () => {
                this.subscriptions.delete(downstream);
                this.fireEvent('unsubscribed', downstream, params);
            };
            downstream.onClose(cleanupHandler);
            upstream.onClose(cleanupHandler);

            downstream.onError(handleError('downstream', this.logger, upstream));
            upstream.onError(handleError('upstream', this.logger, downstream));
            downstream.onClose(handleClose('downstream', this.logger, upstream));
            upstream.onClose(handleClose('upstream', this.logger, downstream));
        } catch (error) {
            // The only exception caught here should be in creating the upstream socket
            handleError('upstream', this.logger, downstream)(error);
        }

        this.fireEvent('subscribed', downstream, params);

        return downstream;
    }

    protected fireEvent(eventType: EventType, client: JSONSocket, params: SubscriptionQuery): void {
        this.eventEmitter.emit(eventType, client, params);
    }

    addSubscribedListener(listener: (client: JSONSocket, params: SubscriptionQuery) => void): this {
        this.eventEmitter.on('subscribed', listener);
        return this;
    }

    removeSubscribedListener(listener: (client: JSONSocket, params: SubscriptionQuery) => void): this {
        this.eventEmitter.off('subscribed', listener);
        return this;
    }

    addUnsubscribedListener(listener: (client: JSONSocket, params: SubscriptionQuery) => void): this {
        this.eventEmitter.on('unsubscribed', listener);
        return this;
    }

    removeUnsubscribedListener(listener: (client: JSONSocket, params: SubscriptionQuery) => void): this {
        this.eventEmitter.off('unsubscribed', listener);
        return this;
    }

    /**
     * Retrieve subscribers on a model URI. If provided, the `filter` may be either
     *
     * - a `string` indicating a property of the subscription options that must have a truthy value, or
     * - a `function` that tests whether the subscription options match some arbitrary predicate
     *
     * @param modelURI the model URI for which to get subscribers
     * @param filter an optional subscriber filter, by options property or a generic predicate
     * @returns the matching subscriber sockets
     */
    protected getSubscribers(modelURI: string, filter?: keyof SubscriptionQuery | ((options: SubscriptionQuery) => boolean)): JSONSocket[] {
        return Array.from(this.subscriptions.keys())
            .filter(client => client.options.modeluri === modelURI)
            .filter(subscriberFilter(filter));
    }

    /**
     * Query whether any subscribers are registered on a model URI. If provided, the `filter` may be either
     *
     * - a `string` indicating a property of the subscription options that must have a truthy value, or
     * - a `function` that tests whether the subscription options match some arbitrary predicate
     *
     * @param modelURI the model URI for which to get subscribers
     * @param filter an optional subscriber filter, by options property or a generic predicate
     * @returns whether any matching subscriptions exist
     */
    protected hasSubscribers(modelURI: string, filter?: keyof SubscriptionQuery | ((options: SubscriptionQuery) => boolean)): boolean {
        return Array.from(this.subscriptions.keys())
            .filter(client => client.options.modeluri === modelURI)
            .some(subscriberFilter(filter));
    }

    hasValidationSubscribers(modelURI: string): boolean {
        return this.hasSubscribers(modelURI, 'livevalidation');
    }

    protected getValidationSubscribers(modelURI: string): JSONSocket[] {
        return this.getSubscribers(modelURI, 'livevalidation');
    }

    async broadcastValidation(modelURI: string, results: Diagnostic): Promise<boolean> {
        const message = {
            type: MessageType.validationResult,
            data: results
        };

        return Promise.all(this.getValidationSubscribers(modelURI).map(client => this.sendSubscriptionMessage(client, message))).then(
            sent => sent.every(each => each)
        );
    }

    async sendValidation(client: JSONSocket, results: Diagnostic): Promise<boolean> {
        const message = {
            type: MessageType.validationResult,
            data: results
        };
        return this.sendSubscriptionMessage(client, message);
    }

    protected async sendSubscriptionMessage(client: JSONSocket, message: ModelServerMessage<any>): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            client.send(message, (error?: Error) => {
                if (error) {
                    this.logger.error('Failed to send subscription message.', error);
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    }
}

const subscriberFilter: (
    filter?: keyof SubscriptionQuery | ((options: SubscriptionQuery) => boolean)
) => (client: Client) => boolean = filter =>
    typeof filter === 'string'
        ? client => !!client.options?.[filter]
        : typeof filter === 'function'
        ? client => client.options && filter(client.options)
        : () => true;
