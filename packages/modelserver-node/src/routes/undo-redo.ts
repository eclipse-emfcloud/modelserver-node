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
import { ModelUpdateResult } from '@eclipse-emfcloud/modelserver-client/lib';
import { Logger, RouteProvider, RouterFactory } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { Request, RequestHandler, Response } from 'express';
import { inject, injectable, named } from 'inversify';
import * as URI from 'urijs';

import { InternalModelServerClientApi } from '../client/model-server-client';
import { ValidationManager } from '../services/validation-manager';
import { handleError, relay } from './routes';

/**
 * Query parameters for the `GET` request on the `undo` or `redo` endpoint.
 */
interface UndoRedoGetQuery {
    /** The model URI to undo/redo. */
    modeluri: string;
}

/**
 * Custom routing of requests on the `/api/v2/{undo,redo}` endpoints.
 * The primary such customization is an intercept of the `GET` requests for undo/redo
 * to integrate custom validation providers in live validation.
 */
@injectable()
export class UndoRedoRoutes implements RouteProvider {
    @inject(Logger)
    @named(UndoRedoRoutes.name)
    protected readonly logger: Logger;

    @inject(InternalModelServerClientApi)
    protected readonly modelServerClient: InternalModelServerClientApi;

    @inject(ValidationManager)
    protected readonly validationManager: ValidationManager;

    configureRoutes(routerFactory: RouterFactory): void {
        const router = routerFactory('/api/v2');
        router.get('/undo', this.interceptUndoRedoGet().bind(this));
        router.get('/redo', this.interceptUndoRedoGet().bind(this));
    }

    /**
     * Create a `GET` request handler for the `/api/v2/{undo,redo}` endpoint to intercept perform live validation
     * with custom validation providers after delegation of the base undo/redo behaviour to the _Upstream Model Server_.
     *
     * @returns the undo/redo intercept handler
     */
    protected interceptUndoRedoGet(): RequestHandler<unknown, any, any, UndoRedoGetQuery, Record<string, any>> {
        return async (req: Request<unknown, any, any, UndoRedoGetQuery, Record<string, any>>, res: Response<any, Record<string, any>>) => {
            const modelURI = req.query.modeluri?.trim();
            if (!modelURI || modelURI === '') {
                handleError(res)('Model URI parameter is absent or empty.');
                return;
            }

            const isUndo = req.path.startsWith('/undo');
            this.logger.debug(`Delegating ${isUndo ? 'undo' : 'redo'} of ${modelURI}.`);

            const delegated = isUndo //
                ? this.modelServerClient.undo(modelURI)
                : this.modelServerClient.redo(modelURI);

            delegated
                .then(this.performLiveValidation(new URI(modelURI)))
                .then(relay(res))
                .catch(handleError(res));
        };
    }

    protected performLiveValidation(modelURI: URI): (delegatedResult: ModelUpdateResult) => Promise<ModelUpdateResult> {
        const validator = this.validationManager;

        return async (delegatedResult: ModelUpdateResult) => validator.performLiveValidation(modelURI).then(() => delegatedResult);
    }
}
