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
import { Logger, MiddlewareProvider, RouteProvider } from '@eclipse-emfcloud/modelserver-plugin-ext';
import axios, { AxiosInstance, AxiosRequestConfig, Method } from 'axios';
import * as express from 'express';
import { RequestHandler } from 'express';
import * as asyncify from 'express-asyncify';
import * as expressWS from 'express-ws';
import { WebsocketRequestHandler } from 'express-ws';
import * as http from 'http';
import { inject, injectable, multiInject, named, optional, postConstruct } from 'inversify';
import * as WebSocket from 'ws';

import { InternalModelServerClientApi } from './client/model-server-client';
import { handleClose, handleError, WSUpgradeRequest } from './client/web-socket-utils';
import { InternalModelServerPluginContext } from './plugin-context';

/**
 * The _Model Server_ core.
 */
@injectable()
export class ModelServer {
    @inject(Logger)
    @named(ModelServer.name)
    protected readonly logger: Logger;

    @inject(InternalModelServerClientApi)
    protected modelServerClient: InternalModelServerClientApi;

    @inject(InternalModelServerPluginContext)
    protected pluginContext: InternalModelServerPluginContext;

    @multiInject(RouteProvider)
    protected routeProviders: RouteProvider[] = [];

    @optional()
    @multiInject(MiddlewareProvider)
    protected middlewareProviders: MiddlewareProvider[] = [];

    @postConstruct()
    protected initialize(): void {
        this.pluginContext.initializePlugins();
    }

    protected server: http.Server;

    /**
     * Serve the Model Server application on the given TCP `port`.
     *
     * @param port the TCP port on which to listen for incoming requests
     * @param upstreamPort the TCP port of the Upstream Model Server to which to forward and/or send requests
     * @return whether the server started
     */
    async serve(port: number, upstreamPort: number): Promise<boolean> {
        // We use async route handlers. Don't modify the Router prototype but explicitly ws-ify routers
        const { applyTo: wsify, app } = asyncify(expressWS(express(), undefined, { leaveRouterUntouched: true }));
        app.use(express.json());

        // Use provided middlewares that are applicable globally
        this.middlewareProviders.flatMap(p => p.getMiddlewares(app)).forEach(mw => app.use(mw));

        // Isolate contributed route handlers each in their own router.
        const routes = {
            routers: [],
            factory: (route: string) => {
                const newRouter = express.Router();
                wsify(newRouter);

                // Apply provided route-specific middlewares
                this.middlewareProviders.flatMap(p => p.getMiddlewares(newRouter, route)).forEach(mw => newRouter.use(mw));

                routes.routers.push({ route, router: newRouter });
                return newRouter;
            },
            install: () => routes.routers.forEach(r => app.use(r.route, r.router))
        };

        for (const routing of this.routeProviders) {
            routing.configureRoutes(routes.factory);
        }
        routes.install();

        const upstream = axios.create({ baseURL: `http://localhost:${upstreamPort}/` });

        app.all('*', this.forward(upstream));
        app.ws('*', this.forwardWS(upstream));

        const result = this.modelServerClient.initialize();
        const resultHandler = (): boolean => {
            this.server = app.listen(port, () => this.logger.info(`Model Server (node.js) listening on port ${port}.`));
            return true;
        };
        if (result instanceof Promise) {
            return result.then(resultHandler);
        }
        return resultHandler();
    }

    /**
     * Stop the server.
     *
     * @returns a promise that resolves when the server is stopped
     */
    async stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server?.close((err?: Error) => {
                if (err) {
                    this.logger.warn('Failed to stop server: %s', err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Create a request handler that forwards requests to the given _Upstream Model Server_.
     *
     * @param upstream the _Upstream Model Server_ to which to forward requests
     * @returns the forwarding request handler
     */
    protected forward(upstream: AxiosInstance): RequestHandler {
        return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
            if (WSUpgradeRequest.is(req)) {
                // Let the websocket middleware handle this
                next();
                return;
            }

            const relayReq: AxiosRequestConfig = {
                url: req.url,
                method: req.method.toUpperCase() as Method,
                data: req.body
            };

            this.logger.debug(`Forwarding ${req.method} request to Upstream Model Server.`);

            upstream
                .request(relayReq)
                .then(relayRes => {
                    res.statusCode = relayRes.status;
                    res.statusMessage = relayRes.statusText;
                    Object.entries(relayRes.headers).forEach(e => res.header(e[0], e[1]));

                    if (relayRes.data) {
                        res.json(relayRes.data);
                    } else {
                        res.send();
                    }
                })
                .catch(error => {
                    if (axios.isAxiosError(error)) {
                        if (error.response) {
                            // Got an error response from Upstream Model Server
                            res.statusCode = error.response.status;
                            res.statusMessage = error.response.statusText;
                            res.json({ data: error.response.data });
                        } else {
                            res.status(500).json(error.toJSON());
                        }
                    } else {
                        res.status(500).send(error);
                    }
                });
        };
    }

    /**
     * Create a request handler that forwards websocket upgrade requests to the given _Upstream Model Server_.
     *
     * @param upstreamServer the _Upstream Model Server_ to which to forward websocket requests
     * @returns the forwarding request handler
     */
    protected forwardWS(upstreamServer: AxiosInstance): WebsocketRequestHandler {
        return (downstream: WebSocket, req: WSUpgradeRequest) => {
            const wsURL = WSUpgradeRequest.getOriginalURL(req);
            const baseURL = WSUpgradeRequest.toWebsocketURL(upstreamServer.defaults.baseURL).replace(/\/+$/, '');
            const url = `${baseURL}${wsURL}`;

            // Relay text data as text
            const rawDataHelper = (sock: WebSocket) => (data: WebSocket.RawData, isBinary: boolean) =>
                isBinary ? sock.send(data) : sock.send(data.toString());

            this.logger.debug(`Forwarding websocket to Upstream Model Server.`);

            let upstream: WebSocket;

            try {
                upstream = new WebSocket(url);

                downstream.on('error', handleError('downstream', this.logger, upstream));
                upstream.on('error', handleError('upstream', this.logger, downstream));
                downstream.on('close', handleClose('downstream', this.logger, upstream));
                upstream.on('close', handleClose('upstream', this.logger, downstream));
                downstream.on('message', rawDataHelper(upstream));
                upstream.on('message', rawDataHelper(downstream));
            } catch (error) {
                // The only exception caught here should be in creating the upstream socket
                handleError('upstream', this.logger, downstream)(error);
            }
        };
    }
}
