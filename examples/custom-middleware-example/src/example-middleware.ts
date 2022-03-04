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

import { Logger, MiddlewareProvider } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { IRouter, RequestHandler } from 'express';
import helmet from 'helmet';
import { inject, injectable, named } from 'inversify';
import * as morgan from 'morgan';

/**
 * A simple example of a plug-in that provides _Express_ middlewares.
 */
@injectable()
export class ExampleCustomMiddlewareProvider implements MiddlewareProvider {
    @inject(Logger)
    @named(ExampleCustomMiddlewareProvider.name)
    protected readonly logger: Logger;

    /**
     * Protect all routes with _Helmet_ (when the `route` is `undefined`)
     * and log custom routes with _Morgan_ (matching on the `route` when provided).
     *
     * @param router the router to which to contribute middlewares
     * @param route the specific route, if any, to which to contribute middlewares
     * @returns the middlewares
     */
    getMiddlewares(router: IRouter, route?: string): RequestHandler[] {
        if (!route) {
            // The `router` is the core Express `Application`. Protect everything
            this.logger.info('Protecting all routes with Helmet.');
            return [helmet()];
        }

        if (route.match(/\/api\/v2\/custom\/?.*/)) {
            // Log custom routes, such as provided by the other example
            this.logger.info('Logging custom API with Morgan: %s', route);
            return [morgan('common')];
        }

        return [];
    }
}
