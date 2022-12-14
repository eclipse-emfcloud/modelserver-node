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
import { inject, injectable, named } from 'inversify';

import { InternalModelServerClientApi } from '../client/model-server-client';
import { forwardWithValidatedModelUri } from './route-utils';

/**
 * Custom routing of requests on the `/api/v2/modelelement` endpoint.
 * The primary such customization is an intercept of the `GET` request for validation
 * to delegate the implementation of custom validation providers.
 *
 * Intercepts model uri validation to be used to forward
 * the base model element query behaviour to the _Upstream Model Server_.
 */
@injectable()
export class ModelElementRoutes implements RouteProvider {
    @inject(Logger)
    @named(ModelElementRoutes.name)
    protected readonly logger: Logger;

    @inject(InternalModelServerClientApi)
    protected readonly modelServerClient: InternalModelServerClientApi;

    configureRoutes(routerFactory: RouterFactory): void {
        /**
         * Create a `GET` request handler for the `/api/v2/modelelement` endpoint
         */
        const router = routerFactory('/api/v2');
        router.get('/modelelement', forwardWithValidatedModelUri());
    }
}
