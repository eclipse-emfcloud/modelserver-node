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
import { ModelServerClientApiV2, ModelServerClientV2, ModelServerObjectV2 } from '@eclipse-emfcloud/modelserver-client';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import * as chai from 'chai';
import { expect } from 'chai';
import { createContainer } from './di';
import { ModelServer } from './server';
import * as chaiLike from 'chai-like';
import { MiddlewareProvider, RouteProvider, RouterFactory } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { IRouter, Request, Response, NextFunction, RequestHandler } from 'express';
import * as sinon from 'sinon';
import { assert } from 'sinon';
import { Container } from 'inversify';
import * as WebSocket from 'ws';

/**
 * Integration tests for the server.
 *
 * These require the Example Coffee Model server from the `eclipse-emfcloud/emfcloud-modelserver` project to be
 * running as the upstream Java server, listening on port 8081
 */
export const integrationTests = undefined;

chai.use(chaiLike);

type MockMiddleware = sinon.SinonSpy<[req: Request, res: Response, next: NextFunction], any>;

interface CoffeeMachine extends ModelServerObjectV2 {
    name?: string;
}

namespace CoffeeMachine {
    export const TYPE = 'http://www.eclipsesource.com/modelserver/example/coffeemodel#//Machine';
}

/** A representation of the upstream _Model Server_, which may or may not be available to tests that need it. */
class UpstreamServer {
    /** The upstream server's base URL. */
    protected readonly baseURL = 'http://localhost:8081/api/v2/';

    /**
     * Test whether the upstream server is available. If not, then call the `ifNot` call-back.
     * The result of the test is cached for future invocations.
     *
     * @param ifNot a call-back to invoke in the case that the upstream server is not available
     */
    async testAvailable(ifNot: () => void): Promise<void> {
        const upstream = new ModelServerClientV2();
        upstream.initialize(this.baseURL);

        return upstream
            .ping()
            .then(() => {
                this.testAvailable = () => Promise.resolve();
            })
            .catch(() => {
                console.log('*** Upstream Java server is not running. Please launch it on port 8081 before running tests.');
                ifNot();
                this.testAvailable = (ifNot: () => void) => {
                    ifNot();
                    return Promise.reject();
                };
            });
    }
}

/** Test fixture wrapping an Inversify-configured _Model Server_ that is started up and stopped for each test case. */
class ServerFixture {
    static upstream = new UpstreamServer();

    readonly baseUrl: string;
    readonly client: ModelServerClientApiV2;
    protected server: ModelServer;

    constructor(protected readonly containerConfig?: (container: Container) => void) {
        this.baseUrl = 'http://localhost:8082/api/v2/';
        this.client = new ModelServerClientV2();
        this.client.initialize(this.baseUrl, 'json-v2');

        beforeEach(this.setup.bind(this));
        afterEach(this.tearDown.bind(this));
    }

    /**
     * Declare that the test suite requires an upstream _Model Server_ to be running, listening on port 8081.
     */
    requireUpstreamServer() {
        before(function (done) {
            ServerFixture.upstream.testAvailable(this.skip.bind(this)).finally(done);
        });
    }

    setup(done: Mocha.Done): void {
        createContainer(8081, 'error')
            .then(container => {
                if (this.containerConfig) {
                    this.containerConfig(container);
                }

                this.server = container.get(ModelServer);
                return this.server.serve(8082, 8081);
            })
            .then(() => done());
    }

    tearDown(done: Mocha.Done): void {
        if (!this.server) {
            // Nothing to stop
            done();
        } else {
            // Don't return a promise
            this.server.stop().finally(done);
        }
    }

    get(path: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
        const rest = this.client['restClient'];
        return rest.get(path, config);
    }
}

describe('Server Integration Tests', () => {
    describe('Requests simply forwarded to upstream', () => {
        let middleware: MockMiddleware;

        const server: ServerFixture = new ServerFixture(container => {
            middleware = provideMiddleware(container);
        });
        server.requireUpstreamServer();
        const { client } = server;

        it('GET /models', async () => {
            const machine = await client.get('SuperBrewer3000.coffee', isCoffeeMachine);
            expect(machine.name).to.be.equal('Super Brewer 3000');
        });

        it('Core route with custom middleware', async () => {
            const pong = await client.ping();
            expect(pong).to.be.true;
            assert.calledOnce(middleware);
        });
    });

    describe('Subscription relays from upstream', () => {
        const server: ServerFixture = new ServerFixture();
        server.requireUpstreamServer();

        it('Subscription connect success message', done => {
            let timeout: NodeJS.Timeout;
            let ws: WebSocket;

            const futureEvent: Promise<WebSocket.MessageEvent> = new Promise(resolve => {
                // N.B.: The v1 API uses the relay, not v2
                ws = new WebSocket('ws://localhost:8082/api/v1/subscribe?modeluri=SuperBrewer3000.coffee&timeout=1000');
                ws.onmessage = resolve;
                timeout = setTimeout(() => ws.close(), 1000);
            });

            futureEvent
                .then(event => {
                    clearTimeout(timeout);
                    ws.close();
                    expect(event.data).to.be.a.string;
                    expect(event.data).to.match(/"type"\s*:\s*"success"/);
                    done();
                })
                .catch(done);
        });
    });

    describe('Custom route provider', () => {
        let middleware: MockMiddleware;

        const server: ServerFixture = new ServerFixture(container => {
            provideEndpoint(
                container,
                '/api/v2/echo',
                route('get', (req, res) => res.json({ message: req.query.message }))
            );
            middleware = provideMiddleware(container, '/api/v2/echo');
        });

        it('GET custom route /echo', done => {
            server
                .get('/echo?message=Hello,%20world')
                .then(res => {
                    expect(res.status).to.be.equal(200);
                    expect(res.data).to.be.like({ message: 'Hello, world' });
                    done();
                })
                .catch(done);
        });

        it('Custom route with custom middleware', done => {
            server
                .get('/echo?message=Hello,%20world')
                .then(res => {
                    assert.calledOnce(middleware);
                    done();
                })
                .catch(done);
        });
    });
});

function isCoffeeMachine(obj: unknown): obj is CoffeeMachine {
    return ModelServerObjectV2.is(obj) && obj.$type === CoffeeMachine.TYPE;
}

/**
 * Create an _Express_ middleware that simply passes to the next middleware, which is spied upon by Sinon
 * to allow assertions about interactions with it, and inject it into the server.
 *
 * @param container the Inversify container
 * @param forRoute the specific route for which to provide the middleware, or omitted to provide the middleware on all routes
 * @returns a mock middleware for Sinon spy assertions
 */
function provideMiddleware(container: Container, forRoute?: string): MockMiddleware {
    const result: MockMiddleware = sinon.spy((req, res, next) => next());
    const middlewareProvider: MiddlewareProvider = {
        getMiddlewares(router: IRouter, route: string) {
            return route === forRoute ? [result] : [];
        }
    };

    container.bind(MiddlewareProvider).toConstantValue(middlewareProvider);
    return result;
}

type SupportedMethod = 'get' | 'put' | 'post' | 'patch' | 'delete';
type CustomRoute = { method: SupportedMethod; path: string; handler: RequestHandler };

function route(method: SupportedMethod, handler: RequestHandler): CustomRoute;
function route(method: SupportedMethod, path: string, handler: RequestHandler): CustomRoute;
function route(method: SupportedMethod, path?: string | RequestHandler, handler?: RequestHandler): CustomRoute {
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

function provideEndpoint(container: Container, basePath: string, ...routes: CustomRoute[]): void {
    const provider: RouteProvider = {
        configureRoutes(routerFactory: RouterFactory) {
            const router = routerFactory(basePath);
            routes.forEach(route => router[route.method](route.path, route.handler));
        }
    };
    container.bind(RouteProvider).toConstantValue(provider);
}
