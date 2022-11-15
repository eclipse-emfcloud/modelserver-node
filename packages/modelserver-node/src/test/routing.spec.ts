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
import { MiddlewareProvider, RouteProvider } from '@eclipse-emfcloud/modelserver-plugin-ext';
import axios, { AxiosInstance } from 'axios';
import * as chai from 'chai';
import { expect } from 'chai';
import * as chaiLike from 'chai-like';
import * as express from 'express';
import { IRouter, RequestHandler } from 'express';
import * as http from 'http';
import * as sinon from 'sinon';
import { assert } from 'sinon';
import * as URI from 'urijs';

import { createContainer } from '../di';
import { ModelServer } from '../server';

/**
 * Tests for integration of _Express_ routers and middlewares contributed by `RouteProvider`s and `MiddlewareProvider`s.
 */
export const routingTests = undefined;

chai.use(chaiLike);

type MockMiddlewareProvider = sinon.SinonSpy<[router: IRouter, route?: string, routerId?: string], RequestHandler[]>;

const testRoutes = '/api/v0/test';
const route1 = testRoutes + '/route1';
const route2 = testRoutes + '/route2';
const route3 = testRoutes + '/route3';
const testRouterID = '$test$router';
const requestTestDataKey = '$test$data';

describe('Routing Tests', () => {
    let server: ModelServer;

    const data: string[] = [];
    let mockMWP: MockMiddlewareProvider;

    let client: AxiosInstance;

    before(() => {
        const baseURL = new URI({ protocol: 'http', hostname: 'localhost', port: '8082' });
        client = axios.create({ baseURL: baseURL.toString() });
    });

    beforeEach(async () => {
        const container = await createContainer(8082, 'error');

        container.bind(RouteProvider).toConstantValue(testRouteProvider());
        mockMWP = sinon.spy((_router, _route, _routerId) => []);
        container.bind(MiddlewareProvider).toConstantValue({ getMiddlewares: mockMWP });
        container.bind(MiddlewareProvider).toConstantValue(testBeforeMiddlewares(data));
        container.bind(MiddlewareProvider).toConstantValue(testAfterMiddlewares());

        server = container.get(ModelServer);
        await server.serve(8082, 8083);
    });

    afterEach(async () => {
        await server.stop();
        data.splice(0, data.length);
    });

    it('Router identification', () => {
        assert.calledWith(
            mockMWP,
            // An `app` has a `_router` property but a `router` does not
            sinon.match(actual => !('_router' in actual)),
            testRoutes,
            testRouterID
        );
    });

    it('Middleware ordering', async () => {
        await client.get(route1);
        expect(data).to.include.ordered.members(['before', 'main handler', 'after']);
    });

    it('Middleware after all routers', async () => {
        await client.get(route1);
        expect(data).to.have.length.greaterThanOrEqual(1);
        expect(data[data.length - 1]).to.be.eq('after all');
    });

    describe('Forwarding backstop', async () => {
        let upstream: express.Application;
        let upstreamServer: http.Server;
        let route3Spy: sinon.SinonSpy;

        before(async () => {
            upstream = express();
            upstream.use(express.json());
            upstream.get(route2, (_req, res) => res.json({ success: true }));
            route3Spy = sinon.spy((_req, res) => res.json({ success: 'upstream' }));
            upstream.get(route3, route3Spy);
            upstreamServer = upstream.listen(8083);
        });

        after(async () => {
            upstreamServer.close();
        });

        it('Pass to upstream', async () => {
            const res = await client.get(route2);
            expect(res.status).to.be.eq(200);
            expect(res.data).to.be.like({ success: true });
        });

        it('Blocked from upstream', async () => {
            const res = await client.get(route3);

            expect(res.status).to.be.eq(200);
            expect(res.data).to.be.like({ success: 'local' });

            assert.notCalled(route3Spy);
        });
    });
});

function testRouteProvider(): RouteProvider {
    return {
        configureRoutes: routerFactory => {
            const router = routerFactory(testRoutes, { routerId: testRouterID });
            router.get('/route1', (req, res, next) => {
                if (requestTestDataKey in req) {
                    const data = req[requestTestDataKey] as string[];
                    data.push('main handler');
                }
                res.json({ success: true, message: 'Main handler called.' });
                return next();
            });
            router.get('/route3', (_req, res, next) => {
                res.json({ success: 'local' });
                next();
            });

            const router2 = routerFactory(route2, { forwardToUpstream: true });
            router2.get('/', (_req, _res, next) => next()); // Just delegate
        }
    };
}

function testBeforeMiddlewares(data: string[]): MiddlewareProvider {
    return {
        getMiddlewares: (router: IRouter, route?: string, routerId?: string) => {
            if (route === testRoutes) {
                return [
                    (req, _res, next) => {
                        data.push('before');
                        req[requestTestDataKey] = data;
                        return next();
                    }
                ];
            }
            return [];
        }
    };
}

function testAfterMiddlewares(): MiddlewareProvider {
    return {
        getAfterMiddlewares: (router: IRouter, route?: string, routerId?: string) => {
            if (!route) {
                // Install a middleware on the root Express `app` after all of the various routers
                return [
                    (req, _res, next) => {
                        if (req.path === route1 && requestTestDataKey in req) {
                            const data = req[requestTestDataKey] as string[];
                            data.push('after all');
                        }
                        return next();
                    }
                ];
            } else if (route === testRoutes) {
                return [
                    (req, _res, next) => {
                        if (requestTestDataKey in req) {
                            const data = req[requestTestDataKey] as string[];
                            data.push('after');
                        }
                        return next();
                    }
                ];
            }
            return [];
        }
    };
}
