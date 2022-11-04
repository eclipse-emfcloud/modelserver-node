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

export interface RoutingOptions {
    /**
     * An optional identifier for the router that middleware providers can
     * filter on to determine whether and/or what middlewares to add to it.
     */
    routerId?: string;
    /**
     * An optional indication of whether the route is also implemented in the
     * upstream Java server and so needs the `next()` delegation eventually
     * to forward to it. If omitted it is assumed that the upstream server
     * does not implement the route and so this forwarding is not provided.
     */
    forwardToUpstream?: boolean;
}

/** Protocol for a factory of Express routers. */
export type RouterFactory = (route: string, options?: RoutingOptions) => Router;

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
     * Obtain middleware handlers to install in the given _Express_ `router` _before_ its core route handlers.
     * These middlewares will be invoked before the main handling of each request, with the opportunity
     * to decorate or modify that request.
     *
     * @param router the router in which the provided middlewares are to be installed
     * @param route the route in which to install the provided middlewares. If not provided, the middlewares are
     *   to be installed in all routes of the `router`
     * @param routerId for a router that was created with an identifier, provides that for application-specific filtering
     *
     * @returns the middlewares to install in the `route`
     */
    getMiddlewares?(router: IRouter, route?: string, routerId?: string): RequestHandler[];

    /**
     * Obtain middleware handlers to install in the given _Express_ `router` _after_ its core route handlers.
     * These middlewares will be invoked after the main handling of each request.
     *
     * @param router the router in which the provided middlewares are to be installed
     * @param route the route in which to install the provided middlewares. If not provided, the middlewares are
     *   to be installed in all routes of the `router`
     * @param routerId for a router that was created with an identifier, provides that for application-specific filtering
     *
     * @returns the middlewares to install in the `route`
     */
    getAfterMiddlewares?(router: IRouter, route?: string, routerId?: string): RequestHandler[];
}
