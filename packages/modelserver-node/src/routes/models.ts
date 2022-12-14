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
import {
    AddCommand,
    AnyObject,
    CompoundCommand,
    encode,
    ModelServerCommand,
    RemoveCommand,
    SetCommand
} from '@eclipse-emfcloud/modelserver-client';
import { Logger, RouteProvider, RouterFactory } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { Response } from 'express';
import { Operation } from 'fast-json-patch';
import { inject, injectable, named } from 'inversify';
import * as URI from 'urijs';

import { ExecuteMessageBody, InternalModelServerClientApi, isModelServerCommand } from '../client/model-server-client';
import { EditService } from '../services/edit-service';
import { ValidationManager } from '../services/validation-manager';
import { handleError, ModelQuery, ModelRequest, ModelRequestHandler, relay, validateFormat, withValidatedModelUri } from './route-utils';

/**
 * Query parameters for the `POST` or `PUT` request on the `models` endpoint.
 */
interface ModelsPostPutQuery extends ModelQuery {
    /** The optional format to query the model. */
    format?: string;
}

/**
 * Custom routing of requests on the `/api/v2/models` endpoint.
 * The primary such customization is an intercept of the `GET` requests for undo/redo
 * to integrate custom validation providers in live validation.
 */
@injectable()
export class ModelsRoutes implements RouteProvider {
    @inject(Logger)
    @named(ModelsRoutes.name)
    protected readonly logger: Logger;

    @inject(InternalModelServerClientApi)
    protected readonly modelServerClient: InternalModelServerClientApi;

    @inject(EditService)
    protected readonly editService: EditService;

    @inject(ValidationManager)
    protected readonly validationManager: ValidationManager;

    configureRoutes(routerFactory: RouterFactory): void {
        const router = routerFactory('/api/v2/models');
        router.post('/', this.interceptModelsPostPut().bind(this));
        router.put('/', this.interceptModelsPostPut().bind(this));
        router.patch('/', this.interceptModelsPatch().bind(this));
    }

    /**
     * Create a `POST` request handler for the `/api/v2/models` endpoint to intercept perform live validation
     * with custom validation providers after delegation of the base post behaviour to the _Upstream Model Server_.
     *
     * @returns the models intercept handler
     */
    protected interceptModelsPostPut(): ModelRequestHandler<ModelsPostPutQuery> {
        return async (req: ModelRequest<ModelsPostPutQuery>, res: Response) => {
            withValidatedModelUri(req, res, async validatedModelUri => {
                const format = validateFormat(req.query.format);

                const model = asModel(req.body?.data);
                if (!model) {
                    handleError(res)('Request body is not a model.');
                    return;
                }

                const isCreate = req.method.toUpperCase() === 'POST';
                this.logger.debug(`Delegating ${isCreate ? 'creation' : 'update'} of ${validatedModelUri.toString()}.`);
                const delegated = isCreate //
                    ? this.modelServerClient.create(validatedModelUri, model, format)
                    : this.modelServerClient.update(validatedModelUri, model, format);

                delegated.then(this.performModelValidation(validatedModelUri)).then(relay(res)).catch(handleError(res));
            });
        };
    }

    /**
     * Create a `PATCH` request handler for the `/api/v2/models` endpoint to intercept custom commands, reach out
     * to registered providers to collect delegate commands, and send those along to the _Upstream Model Server_ to complete
     * the edit request.
     *
     * @returns the edit-command intercept handler
     */
    protected interceptModelsPatch(): ModelRequestHandler {
        return async (req: ModelRequest, res: Response) => {
            withValidatedModelUri(req, res, async validatedModelUri => {
                const message = req.body?.data;
                if (message && ExecuteMessageBody.isPatch(message)) {
                    return this.forwardEdit(validatedModelUri, message.data, res);
                }

                const command = asModelServerCommand(message?.data);
                if (!command) {
                    handleError(res)('Request body is not a ModelServerCommand.');
                    return;
                }

                return this.forwardEdit(validatedModelUri, command, res);
            });
        };
    }

    protected forwardEdit(
        modelURI: URI,
        patchOrCommand: Operation | Operation[] | ModelServerCommand,
        res: Response<any, Record<string, any>>
    ): void {
        this.editService.edit(modelURI, patchOrCommand).then(relay(res)).catch(handleError(res));
    }

    /**
     * Follow up creation or replacement of a model with validation of the same.
     *
     * @param modelURI the model created or replaced
     * @returns the created or replacing model
     */
    protected performModelValidation(modelURI: URI): (delegatedResult: AnyObject) => Promise<AnyObject> {
        const validator = this.validationManager;

        return async (delegatedResult: AnyObject) => validator.performLiveValidation(modelURI).then(() => delegatedResult);
    }
}

function asModel(object: any): AnyObject | string | undefined {
    if (typeof object === 'string') {
        return object;
    }
    if (AnyObject.is(object)) {
        return object;
    }

    return undefined;
}

/**
 * Ensure that a command parsed from incoming JSON is a proper instance of the
 * {@link ModelServerCommand} or {@link CompoundCommand} class.
 * This ensures that, for example, methods of the `ModelServerCommand` class
 * are available on the command object.
 *
 * @param command a command
 * @returns the command as a proper instance of the {@link ModelServerCommand} class
 *   or a subclass
 */
function asModelServerCommand(command: any): ModelServerCommand | undefined {
    if (command) {
        // The client uses json-v2 format exclusively for commands/patches
        command = encode('json')(command);
    }

    if (!(command instanceof ModelServerCommand) && isModelServerCommand(command)) {
        let proto: typeof ModelServerCommand.prototype;

        switch (command.eClass) {
            case AddCommand.URI:
                proto = AddCommand.prototype;
                break;
            case RemoveCommand.URI:
                proto = RemoveCommand.prototype;
                break;
            case SetCommand.URI:
                proto = SetCommand.prototype;
                break;
            case CompoundCommand.URI:
                proto = CompoundCommand.prototype;
                break;
            default:
                proto = ModelServerCommand.prototype;
                break;
        }

        Object.setPrototypeOf(command, proto);
        return command as ModelServerCommand;
    }

    return undefined;
}
