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
import { IRouter, RequestHandler } from 'express';
import { Router } from 'express-ws';

export const RouteProvider = Symbol('RouteProvider');

/** Protocol for a factory of Express routers. */
export type RouterFactory = (route: string) => Router;

/**
 * A provider of custom routing in the _Express_ `app`.
 */
export interface RouteProvider {
    /**
     * Configure routes in an _Express_ plug-in router.
     *
     * @param routerFactory creates an the _Express_ router on a given route
     *    for plug-in route handlers to install themselves into
     */
    configureRoutes(routerFactory: RouterFactory): void;
}

export const MiddlewareProvider = Symbol('MiddlewareProvider');

/**
 * A provider of middlewares to install in _Express_ routers.
 */
export interface MiddlewareProvider {
    /**
     * Obtain middleware handlers to install in the given _Express_ `router`.
     *
     * @param router the router in which the provided middlewares are to be installed
     * @param route the route in which to install the provided middlewares. If not provided, the middlewares are
     *   to be installed in all routes of the `router`
     *
     * @returns the middlewares to install in the `route`
     */
    getMiddlewares(router: IRouter, route?: string): RequestHandler[];
}
