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
import URI = require('urijs');

import { InternalModelServerClientApi } from '../client/model-server-client';
import { ValidationManager } from '../services/validation-manager';
import { ValidationProviderRegistry } from '../validation-provider-registry';
import { handleError, relay } from './routes';

/**
 * Query parameters for the `GET` request on the `validation` endpoint.
 */
interface ValidationGetQuery {
    /** The model URI to edit. */
    modeluri: string;
}

/**
 * Custom routing of requests on the `/api/v2/validation` endpoint.
 * The primary such customization is an intercept of the `GET` request for validation
 * to delegate the implementation of custom validation providers.
 */
@injectable()
export class ValidationRoutes implements RouteProvider {
    @inject(Logger)
    @named(ValidationRoutes.name)
    protected readonly logger: Logger;

    @inject(InternalModelServerClientApi)
    protected readonly modelServerClient: InternalModelServerClientApi;

    @inject(ValidationProviderRegistry)
    protected readonly validationProviderRegistry: ValidationProviderRegistry;

    @inject(ValidationManager)
    protected readonly validationManager: ValidationManager;

    configureRoutes(routerFactory: RouterFactory): void {
        routerFactory('/api/v2/validation').get('/', this.interceptValidationGet().bind(this));
    }

    /**
     * Create a `GET` request handler for the `/api/v2/validation` endpoint to intercept validation requests, reach out
     * to registered providers to collect additional diagnostics, and combine those results with basic validation
     * results from the _Upstream Model Server_ to complete the validation request.
     *
     * @returns the validation intercept handler
     */
    protected interceptValidationGet(): RequestHandler<unknown, any, any, ValidationGetQuery, Record<string, any>> {
        return async (
            req: Request<unknown, any, any, ValidationGetQuery, Record<string, any>>,
            res: Response<any, Record<string, any>>
        ) => {
            const modelURI = req.query.modeluri?.trim();
            if (!modelURI || modelURI === '') {
                handleError(res)('Model URI parameter is absent or empty.');
                return;
            }

            this.validationManager.validate(new URI(modelURI)).then(relay(res)).catch(handleError(res));
        };
    }
}
