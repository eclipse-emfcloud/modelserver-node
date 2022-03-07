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
        const router = routerFactory('/api/v2/custom/greeter');

        this.logger.info('Configuring /api/v2/custom/greeter endpoint.');

        router.get('/greet/:name', this.greet().bind(this));
        router.get('/who', this.who().bind(this));
    }

    /**
     * Respond to a greeting request.
     *
     * @returns the greet handler
     */
    protected greet(): RequestHandler {
        return (req: Request, res: Response) => {
            const data = greeter.greet(req.params.name);

            res.json({ type: 'success', data });
        };
    }

    /**
     * Respond to a request for names of all the greeted.
     *
     * @returns the who handler
     */
    protected who(): RequestHandler {
        return (req: Request, res: Response) => {
            const data = Array.from(greeter.greeted);

            res.json({ type: 'success', data });
        };
    }
}

const greeter = {
    greeted: new Set<string>(),
    greet: (name?: string) => {
        if (name) {
            greeter.greeted.add(name);
        }
        return `Hello, ${name ?? 'caller'}!`;
    }
};
