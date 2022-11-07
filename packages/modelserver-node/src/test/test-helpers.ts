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
import { Diagnostic, SubscriptionListener } from '@eclipse-emfcloud/modelserver-client';
import {
    EditTransaction,
    MiddlewareProvider,
    ModelServerClientApi,
    RouteProvider,
    RouterFactory
} from '@eclipse-emfcloud/modelserver-plugin-ext';
import { expect } from 'chai';
import { IRoute, IRouter, NextFunction, Request, RequestHandler, Response } from 'express';
import { Container } from 'inversify';
import { Context } from 'mocha';
import * as sinon from 'sinon';
import * as URI from 'urijs';
import * as WebSocket from 'ws';

export type MockMiddleware = sinon.SinonSpy<[req: Request, res: Response, next: NextFunction], any>;

/**
 * Create an _Express_ middleware that simply passes to the next middleware, which is spied upon by Sinon
 * to allow assertions about interactions with it, and inject it into the server.
 *
 * @param container the Inversify container
 * @param forRoute the specific route for which to provide the middleware, or omitted to provide the middleware on all routes
 * @returns a mock middleware for Sinon spy assertions
 */
export function provideMiddleware(container: Container, forRoute?: string): MockMiddleware {
    const result: MockMiddleware = sinon.spy((req, res, next) => next());
    const middlewareProvider: MiddlewareProvider = {
        getMiddlewares(router: IRouter, aRoute: string) {
            return aRoute === forRoute ? [result] : [];
        }
    };

    container.bind(MiddlewareProvider).toConstantValue(middlewareProvider);
    return result;
}

export type SupportedMethod = keyof Pick<IRoute, 'get' | 'put' | 'post' | 'patch' | 'delete'>;
export interface CustomRoute {
    method: SupportedMethod;
    path: string;
    handler: RequestHandler;
}

export function route(method: SupportedMethod, handler: RequestHandler): CustomRoute;
export function route(method: SupportedMethod, path: string, handler: RequestHandler): CustomRoute;
export function route(method: SupportedMethod, path?: string | RequestHandler, handler?: RequestHandler): CustomRoute {
    if (typeof path === 'function') {
        handler = path;
        path = '/';
    } else if (typeof path === 'undefined') {
        handler = (req, res, next) => next();
        path = '/';
    } else if (!handler) {
        handler = (req, res, next) => next();
    }

    return { method, path, handler };
}

export function provideEndpoint(container: Container, basePath: string, ...routes: CustomRoute[]): void {
    const provider: RouteProvider = {
        configureRoutes(routerFactory: RouterFactory) {
            const router = routerFactory(basePath);
            routes.forEach(aRoute => router[aRoute.method](aRoute.path, aRoute.handler));
        }
    };
    container.bind(RouteProvider).toConstantValue(provider);
}

export interface SocketTimeout {
    clear(): void;
}

export function socketTimeout(ws: WebSocket, reject: (reason?: any) => void): SocketTimeout {
    const result = setTimeout(() => {
        ws.close();
        reject(new Error('timeout'));
    }, 1000);

    return {
        clear: () => {
            ws.close();
            clearTimeout(result);
        }
    };
}

export function captureMessage(ws: WebSocket, filter?: (msg: WebSocket.MessageEvent) => boolean): Promise<WebSocket.MessageEvent> {
    let timeout: SocketTimeout;

    return new Promise<WebSocket.MessageEvent>((resolve, reject) => {
        ws.onmessage = msg => {
            if (!filter || filter(msg)) {
                resolve(msg);
            }
        };
        timeout = socketTimeout(ws, reject);
    }).then(result => {
        timeout.clear();
        return result;
    });
}

export function awaitClosed(transaction: EditTransaction): Promise<boolean> {
    let timeout: SocketTimeout;

    return new Promise(resolve => {
        const check = setInterval(() => {
            if (!transaction.isOpen()) {
                clearInterval(check);
                timeout.clear();
                resolve(true);
            }
        }, 50);

        timeout = socketTimeout(transaction['socket'], reason => {
            clearInterval(check);
            resolve(false);
        });
    });
}

export function requireArray(owner: object, propertyName: string): unknown[] {
    expect(owner[propertyName]).to.be.an('array').that.is.not.empty;
    return owner[propertyName] as unknown[];
}

export function assumeThatCondition(this: Context, condition: boolean, reason: string): void {
    if (!condition) {
        if (this.test) {
            this.test.title = `${this.test.title} - skipped: ${reason}`;
        }
    }
}

export function findDiagnostic(diagnostic: Diagnostic, source: string): Diagnostic | undefined {
    if (diagnostic.source === source) {
        return diagnostic;
    }

    for (const child of diagnostic.children) {
        const result = findDiagnostic(child, source);
        if (result) {
            return result;
        }
    }

    return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const pass = (): void => {};

/**
 * Listen for the full-update message that signals either close or deletion of a model,
 * according to the requested `mode`.
 *
 * @param client the model server client on which to add a subscription listener
 * @param modelURI the model on which to add a subscription listener
 * @param mode the wait mode
 * @returns a promise to await to synchronize with listener attachment and another to
 *          await to synchronize with receipt of the matching full-update message
 */
export function listenForFullUpdate(
    client: ModelServerClientApi,
    modelURI: URI,
    mode: 'close' | 'delete'
): { ready: Promise<boolean>; done: Promise<boolean> } {
    let result: Promise<boolean>;
    const listening = new Promise<boolean>(resolveListening => {
        result = new Promise<boolean>(resolveResult => {
            // Cannot use the NotificationSubscriptionListenerV2 API to listen for model
            // close or delete because it throws an error on attempt to map the null model
            // int the full-update message that signals close/delete
            const listener: SubscriptionListener = {
                onError: (uri, event) => {
                    expect.fail(`Error in ${uri} subscription: ${event.error}`);
                },
                onMessage: (_uri, event) => {
                    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                    // Close doesn't, in practice, yield a `null` update because the model controller
                    // immediately re-loads the resource from storage.
                    // eslint-disable-next-line no-null/no-null
                    if (data.type === 'fullUpdate' && (mode === 'close' || data.data == null)) {
                        resolveResult(true);
                    }
                },
                onOpen: () => resolveListening(true),
                onClose: pass
            };
            client.subscribe(modelURI.toString(), listener);
        });
    });
    return { ready: listening, done: result! };
}
