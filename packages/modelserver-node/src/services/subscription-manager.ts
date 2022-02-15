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

import { Diagnostic, MessageType } from '@eclipse-emfcloud/modelserver-client';
import { Logger } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { inject, injectable, named } from 'inversify';
import { stringify as unparseQuery } from 'qs';
import * as WebSocket from 'ws';

import { UpstreamConnectionConfig } from '../client/model-server-client';
import { handleClose, handleError, JSONSocket } from '../client/web-socket-utils';

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

type Client = JSONSocket & { options?: SubscriptionQuery };

@injectable()
export class SubscriptionManager {
    @inject(Logger)
    @named(SubscriptionManager.name)
    protected readonly logger: Logger;

    @inject(UpstreamConnectionConfig)
    protected readonly upstreamConnectionConfig: UpstreamConnectionConfig;

    /** Map of downstream (client) socket to upstream (Upstream Model Server) socket. */
    protected readonly subscriptions: Map<Client, JSONSocket> = new Map();

    addSubscription(client: WebSocket, endpoint: string, params: SubscriptionQuery): void {
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
            const cleanupHandler: () => void = () => this.subscriptions.delete(downstream);
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
    }

    hasValidationSubscribers(modelURI: string): boolean {
        return Array.from(this.subscriptions.keys()).some(client => client.options?.livevalidation && client.options.modeluri === modelURI);
    }

    protected getValidationSubscribers(modelURI: string): JSONSocket[] {
        return Array.from(this.subscriptions.keys()).filter(
            client => client.options?.livevalidation && client.options.modeluri === modelURI
        );
    }

    async broadcastValidation(modelURI: string, results: Diagnostic): Promise<boolean> {
        const message = {
            type: MessageType.validationResult,
            data: results
        };
        return Promise.all(
            this.getValidationSubscribers(modelURI).map(
                client =>
                    new Promise<boolean>(resolve => {
                        client.send(message, (error?: Error) => {
                            if (error) {
                                this.logger.error('Failed to send subscription message.', error);
                                resolve(false);
                            } else {
                                resolve(true);
                            }
                        });
                    })
            )
        ).then(sent => sent.every(each => each));
    }
}
