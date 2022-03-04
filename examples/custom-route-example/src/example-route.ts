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
import { Request, RequestHandler, Response } from 'express';
import { inject, injectable, named } from 'inversify';

/**
 * A simple example of a plug-in that provides API routes.
 */
@injectable()
export class ExampleCustomRouteProvider implements RouteProvider {
    @inject(Logger)
    @named(ExampleCustomRouteProvider.name)
    protected readonly logger: Logger;

    configureRoutes(routerFactory: RouterFactory): void {
        const router = routerFactory('/api/v2/custom/greet');

        this.logger.info('Configuring /api/v2/custom/greet endpoint.');

        router.get('/:name', this.greet().bind(this));
    }

    /**
     * Respond to a greeting request.
     *
     * @returns the greeting handler
     */
    protected greet(): RequestHandler {
        return async (req: Request, res: Response) => {
            const name = req.params.name ?? 'Caller';

            res.json({ type: 'success', message: `Hello, ${name}!` });
        };
    }
}
